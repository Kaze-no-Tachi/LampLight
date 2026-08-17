import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import { auditLog, enrollments } from '@/db/schema';
import {
  CORNERSTONE,
  courseBySlug,
  GRACE,
  programBySlug,
  userByKey,
} from '@/db/seed-data';
import { hasActiveEntitlement } from '@/db/repositories/entitlements';
import { grantEnrollment, revokeEnrollment } from '@/lib/entitlements/grants';

/**
 * Manual enrollment (PRD requirement P0-11).
 *
 * Granting access is the most consequential thing an institute admin does, so
 * what is asserted here is not that the happy path writes a row. It is the ways
 * the request can be wrong: a person who is not a member, a course belonging to
 * somebody else, a grant that already exists, an expiry in the past, and a
 * revocation aimed at another institute's row.
 *
 * The admin client is used only to read back what the code wrote and to remove
 * what these tests created, never to arrange a result, so nothing here can pass
 * because the fixture was set up to make it pass.
 *
 * CLEANUP IS BY ID, NOT BY USER.
 *
 * An earlier version deleted every enrollment belonging to the test subject,
 * which quietly destroyed the seeded rows the access predicate suite depends on:
 * that file then failed, in a way that looked like a bug in the predicate. The
 * suite shares one database and one fork, so a test that deletes more than it
 * made is a test that breaks other files.
 */

const NOBODY = '00000000-0000-4000-8000-000000000001';

/** Ids these tests created, and the only rows cleanup is allowed to touch. */
const created = new Set<string>();

const student2 = userByKey(GRACE, 'student2');
const graceAdmin = userByKey(GRACE, 'admin');

/**
 * Courses student2 does not already hold.
 *
 * They are seeded with church-history directly and with the certificate
 * program, which covers church-history, hermeneutics, and pastoral-ministry.
 * Granting one of those would answer "already" and prove nothing.
 */
const UNHELD_COURSE = 'old-testament-survey';
const UNHELD_PROGRAM = 'diploma-in-biblical-studies';

async function grant(params: {
  tenantId?: string;
  userId?: string;
  sourceKind: 'program' | 'course';
  sourceId: string;
  expiresAt?: Date | null;
  reason?: string;
}) {
  const outcome = await grantEnrollment({
    tenantId: params.tenantId ?? GRACE.id,
    actorUserId: graceAdmin.id,
    userId: params.userId ?? student2.id,
    sourceKind: params.sourceKind,
    sourceId: params.sourceId,
    expiresAt: params.expiresAt ?? null,
    ...(params.reason === undefined ? {} : { reason: params.reason }),
  });

  if (outcome.status === 'granted') created.add(outcome.enrollmentId);
  return outcome;
}

async function cleanup(): Promise<void> {
  if (created.size === 0) return;
  await getAdminDb()
    .delete(enrollments)
    .where(inArray(enrollments.id, [...created]));
  created.clear();
}

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await closeDb();
});

describe('what a grant requires', () => {
  it('enrols a member of this institute, and the predicate then says yes', async () => {
    const course = courseBySlug(GRACE, UNHELD_COURSE);

    const outcome = await grant({
      sourceKind: 'course',
      sourceId: course.id,
      reason: 'scholarship',
    });
    expect(outcome.status).toBe('granted');

    const entitled = await getTenantDb(GRACE.id).run((scope) =>
      hasActiveEntitlement(scope, student2.id, course.id),
    );
    expect(entitled).toBe(true);
  });

  it('records who did it, on the row and in the audit log', async () => {
    // P0-11 asks for granted_by and an audit row, because an institute needs to
    // answer "who let this person in" months later.
    const outcome = await grant({
      sourceKind: 'course',
      sourceId: courseBySlug(GRACE, UNHELD_COURSE).id,
    });
    if (outcome.status !== 'granted') throw new Error('grant failed');

    const db = getAdminDb();

    const [row] = await db
      .select({ actor: auditLog.actorUserId, action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, GRACE.id),
          eq(auditLog.targetId, outcome.enrollmentId),
        ),
      );
    expect(row?.action).toBe('enrollment.granted');
    expect(row?.actor).toBe(graceAdmin.id);

    const [enrollment] = await db
      .select({ grantedBy: enrollments.grantedBy })
      .from(enrollments)
      .where(eq(enrollments.id, outcome.enrollmentId));
    expect(enrollment?.grantedBy).toBe(graceAdmin.id);
  });

  it('refuses somebody who is not a member here', async () => {
    // A user id is global. Without the membership check an admin could type any
    // id on the platform and attach an entitlement to a stranger.
    const outcome = await grant({
      userId: userByKey(CORNERSTONE, 'student1').id,
      sourceKind: 'course',
      sourceId: courseBySlug(GRACE, UNHELD_COURSE).id,
    });

    expect(outcome.status).toBe('error');
  });

  it('refuses a course that belongs to another institute', async () => {
    // Ids are unguessable, and unguessable is not an access control. Both
    // institutes own a course with this slug, so the wrong id is a real row.
    const outcome = await grant({
      sourceKind: 'course',
      sourceId: courseBySlug(CORNERSTONE, UNHELD_COURSE).id,
    });

    expect(outcome.status).toBe('error');

    const rows = await getAdminDb()
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, student2.id),
          eq(enrollments.sourceId, courseBySlug(CORNERSTONE, UNHELD_COURSE).id),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it('refuses a source that exists nowhere', async () => {
    const outcome = await grant({ sourceKind: 'program', sourceId: NOBODY });
    expect(outcome.status).toBe('error');
  });

  it('refuses an expiry in the past, which would grant nothing', async () => {
    const outcome = await grant({
      sourceKind: 'course',
      sourceId: courseBySlug(GRACE, UNHELD_COURSE).id,
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(outcome.status).toBe('error');
  });

  it('says so rather than failing when they already have it', async () => {
    const source = {
      sourceKind: 'program' as const,
      sourceId: programBySlug(GRACE, UNHELD_PROGRAM).id,
    };

    expect((await grant(source)).status).toBe('granted');
    // The unique constraint would raise here. An admin clicking twice deserves
    // an answer, not a stack trace.
    expect((await grant(source)).status).toBe('already');
  });

  it('stops granting access when it expires', async () => {
    const course = courseBySlug(GRACE, UNHELD_COURSE);

    const outcome = await grant({ sourceKind: 'course', sourceId: course.id });
    if (outcome.status !== 'granted') throw new Error('grant failed');

    // Moved into the past rather than waiting: what is being checked is that
    // the predicate reads expiry, which it does in SQL against now().
    await getAdminDb()
      .update(enrollments)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(enrollments.id, outcome.enrollmentId));

    const entitled = await getTenantDb(GRACE.id).run((scope) =>
      hasActiveEntitlement(scope, student2.id, course.id),
    );
    expect(entitled).toBe(false);
  });
});

describe('revoking', () => {
  it('removes access and records it', async () => {
    const course = courseBySlug(GRACE, UNHELD_COURSE);
    const granted = await grant({ sourceKind: 'course', sourceId: course.id });
    if (granted.status !== 'granted') throw new Error('grant failed');

    const outcome = await revokeEnrollment({
      tenantId: GRACE.id,
      actorUserId: graceAdmin.id,
      enrollmentId: granted.enrollmentId,
    });
    expect(outcome.status).toBe('revoked');

    const entitled = await getTenantDb(GRACE.id).run((scope) =>
      hasActiveEntitlement(scope, student2.id, course.id),
    );
    expect(entitled).toBe(false);

    const [row] = await getAdminDb()
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetId, granted.enrollmentId),
          eq(auditLog.action, 'enrollment.revoked'),
        ),
      );
    expect(row?.action).toBe('enrollment.revoked');
  });

  it('will not touch another institute enrollment', async () => {
    // THE ONE THAT MATTERS. Cornerstone's seeded enrollment is a real row with
    // a real id, and an admin at Grace holding that id must achieve nothing.
    const target = CORNERSTONE.enrollments[0];
    if (!target) throw new Error('fixture has no enrollment to aim at');

    const outcome = await revokeEnrollment({
      tenantId: GRACE.id,
      actorUserId: graceAdmin.id,
      enrollmentId: target.id,
    });

    // not_found rather than a refusal, so nothing is learned about the id.
    expect(outcome.status).toBe('not_found');

    const [survivor] = await getAdminDb()
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(eq(enrollments.id, target.id));
    expect(survivor?.id).toBe(target.id);
  });

  it('answers the same for an id that never existed', async () => {
    const outcome = await revokeEnrollment({
      tenantId: GRACE.id,
      actorUserId: graceAdmin.id,
      enrollmentId: NOBODY,
    });
    expect(outcome.status).toBe('not_found');
  });
});
