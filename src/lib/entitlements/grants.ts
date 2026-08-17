import { and, eq } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import {
  findMembership,
  listGrantableSources,
} from '@/db/repositories/entitlements';
import { auditLog, enrollments } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Manual enrollment (PRD requirement P0-11).
 *
 * WHAT THIS IS FOR
 *
 * An institute teaching on Lamplight before it takes payments, an institute
 * that takes payment by cheque, a scholarship, a staff member who needs to see
 * a course, a student whose card failed but who is sitting in the class. All of
 * these are ordinary, and all of them are an admin deciding somebody has
 * access.
 *
 * WHAT IT CHECKS, AND WHY EACH CHECK IS HERE
 *
 * Granting access is the most consequential thing an institute admin can do, so
 * nothing about the request is trusted:
 *
 *   1. The actor is an admin of the tenant resolved from the Host header. That
 *      is the caller's job, through requireRole, and this module is never
 *      reachable without it.
 *   2. The person being granted must already be a member of THIS institute. A
 *      user id is global, so without this an admin could type any id on the
 *      platform and attach an entitlement to a stranger. Membership is also
 *      what the access predicate requires, so a grant without one would be a
 *      row that grants nothing and confuses everybody later.
 *   3. The source must exist in this institute. Ids are uuids and unguessable,
 *      but "unguessable" is not an access control, and a cross-tenant source id
 *      would produce an entitlement pointing at another institute's course.
 *   4. Every grant and every revocation writes an audit row, with the actor.
 *      This is the standing rule for anything that changes who can get in.
 *
 * Failures return a reason rather than throwing, because every one of them is
 * something an admin can act on, and none of them is secret from an admin of
 * the institute in question.
 */

export type GrantOutcome =
  | { status: 'granted'; enrollmentId: string }
  | { status: 'already' }
  | { status: 'error'; message: string };

export type GrantRequest = {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly userId: string;
  readonly sourceKind: 'program' | 'course';
  readonly sourceId: string;
  /** Null means access does not lapse. */
  readonly expiresAt: Date | null;
  /** Why, in the admin's words. Ends up in the audit row, not on the grant. */
  readonly reason?: string;
};

export async function grantEnrollment(
  request: GrantRequest,
): Promise<GrantOutcome> {
  if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
    return {
      status: 'error',
      message: 'That expiry is in the past, so the grant would do nothing.',
    };
  }

  return getTenantDb(request.tenantId).run(async (scope) => {
    const membership = await findMembership(scope, request.userId);
    if (!membership) {
      return {
        status: 'error' as const,
        message: 'That person is not a member of this institute.',
      };
    }

    if (!(await sourceExists(scope, request.sourceKind, request.sourceId))) {
      return {
        status: 'error' as const,
        message: 'That course or program does not exist here.',
      };
    }

    // The unique constraint on (tenant, user, kind, source) is the real guard
    // against a double grant. Checking first turns a constraint violation into
    // an answer an admin can read, and the constraint still catches the race.
    const existing = await scope.tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, scope.tenantId),
          eq(enrollments.userId, request.userId),
          eq(enrollments.sourceKind, request.sourceKind),
          eq(enrollments.sourceId, request.sourceId),
        ),
      )
      .limit(1);

    if (existing.length > 0) return { status: 'already' as const };

    const [inserted] = await scope.tx
      .insert(enrollments)
      .values({
        tenantId: scope.tenantId,
        userId: request.userId,
        sourceKind: request.sourceKind,
        sourceId: request.sourceId,
        expiresAt: request.expiresAt,
        // What makes this a grant rather than a purchase, and what the student's
        // own profile page reads to say "enrolled by the office".
        grantedBy: request.actorUserId,
      })
      .returning({ id: enrollments.id });

    if (!inserted) {
      return { status: 'error' as const, message: 'The grant did not save.' };
    }

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: request.actorUserId,
      action: 'enrollment.granted',
      targetType: 'enrollment',
      targetId: inserted.id,
      metadataJson: {
        userId: request.userId,
        sourceKind: request.sourceKind,
        sourceId: request.sourceId,
        expiresAt: request.expiresAt?.toISOString() ?? null,
        reason: request.reason ?? null,
      },
    });

    return { status: 'granted' as const, enrollmentId: inserted.id };
  });
}

export type RevokeOutcome =
  | { status: 'revoked' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/**
 * Takes access away.
 *
 * Deletes the row rather than expiring it. An expiry in the past and a deleted
 * row read identically to the access predicate, and the audit row is what
 * preserves the history, so keeping a tombstone in the entitlements table would
 * only make every read filter around it.
 *
 * A row belonging to another institute answers not_found, exactly as a row that
 * never existed does. An admin has no business learning that an id is real
 * somewhere else.
 */
export async function revokeEnrollment(params: {
  tenantId: string;
  actorUserId: string;
  enrollmentId: string;
  reason?: string;
}): Promise<RevokeOutcome> {
  return getTenantDb(params.tenantId).run(async (scope) => {
    const [removed] = await scope.tx
      .delete(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, scope.tenantId),
          eq(enrollments.id, params.enrollmentId),
        ),
      )
      .returning({
        id: enrollments.id,
        userId: enrollments.userId,
        sourceKind: enrollments.sourceKind,
        sourceId: enrollments.sourceId,
        grantedBy: enrollments.grantedBy,
      });

    if (!removed) return { status: 'not_found' as const };

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: params.actorUserId,
      action: 'enrollment.revoked',
      targetType: 'enrollment',
      targetId: removed.id,
      metadataJson: {
        userId: removed.userId,
        sourceKind: removed.sourceKind,
        sourceId: removed.sourceId,
        // Recorded because revoking something that was paid for is a different
        // conversation from revoking a scholarship, and the row is gone after
        // this.
        wasGranted: removed.grantedBy !== null,
        reason: params.reason ?? null,
      },
    });

    return { status: 'revoked' as const };
  });
}

export type SelfEnrollOutcome =
  | { status: 'enrolled'; enrollmentId: string }
  | { status: 'already' }
  | { status: 'error'; message: string };

export type SelfEnrollRequest = {
  readonly tenantId: string;
  readonly userId: string;
  readonly courseId: string;
};

/**
 * A member putting themselves on a published course (round 2 of the course
 * and lesson flow: "enroll works on any published course, ignoring price").
 *
 * Deliberately not grantEnrollment with the actor set to themselves.
 * `grantedBy` stays null here, which is what the rest of the product reads as
 * "purchased" rather than "granted by staff": the profile page and the access
 * panel both switch on it. Setting it to the caller's own id would misreport a
 * self-service enrolment as an admin's decision, when no admin was involved.
 * Payments are not built yet, so this is the whole purchase for now, taken
 * knowingly, revisited when Phase 11 lands.
 *
 * Callers must have already asked `can(scope, actor, 'course:enroll', ...)`,
 * which is where published, archived and already-enrolled are decided. This
 * still re-checks that the course exists here and re-does the duplicate
 * check, because a server action is a public endpoint and the predicate call
 * is the caller's responsibility, not a guarantee this function can lean on.
 * A membership check is not repeated: unlike an admin's grant, `userId` here
 * is always the caller's own session-derived id, never a value typed into a
 * form, so there is no "type any id on the platform" risk to guard against.
 */
export async function enrollSelf(
  request: SelfEnrollRequest,
): Promise<SelfEnrollOutcome> {
  return getTenantDb(request.tenantId).run(async (scope) => {
    if (!(await sourceExists(scope, 'course', request.courseId))) {
      return {
        status: 'error' as const,
        message: 'That course does not exist here.',
      };
    }

    const existing = await scope.tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, scope.tenantId),
          eq(enrollments.userId, request.userId),
          eq(enrollments.sourceKind, 'course'),
          eq(enrollments.sourceId, request.courseId),
        ),
      )
      .limit(1);

    if (existing.length > 0) return { status: 'already' as const };

    const [inserted] = await scope.tx
      .insert(enrollments)
      .values({
        tenantId: scope.tenantId,
        userId: request.userId,
        sourceKind: 'course',
        sourceId: request.courseId,
        expiresAt: null,
        grantedBy: null,
      })
      .returning({ id: enrollments.id });

    if (!inserted) {
      return {
        status: 'error' as const,
        message: 'The enrolment did not save.',
      };
    }

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: request.userId,
      action: 'enrollment.self_enrolled',
      targetType: 'enrollment',
      targetId: inserted.id,
      metadataJson: {
        userId: request.userId,
        sourceKind: 'course',
        sourceId: request.courseId,
      },
    });

    return { status: 'enrolled' as const, enrollmentId: inserted.id };
  });
}

async function sourceExists(
  scope: TenantScope,
  kind: 'program' | 'course',
  id: string,
): Promise<boolean> {
  const sources = await listGrantableSources(scope);
  return sources.some((source) => source.kind === kind && source.id === id);
}
