import { and, eq, exists, gt, isNull, or, sql } from 'drizzle-orm';
import {
  courseInstructors,
  enrollments,
  memberships,
  programCourses,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Example repository, entitlement reads.
 *
 * These are the three reads the access predicate depends on (PRD section 7).
 * The predicate itself lands in the entitlements phase. What matters here is
 * that the queries it will call are already tenant-scoped, so the predicate
 * never has to think about tenancy.
 */

export type MembershipRecord = {
  userId: string;
  role: 'student' | 'instructor' | 'admin';
};

export async function findMembership(
  scope: TenantScope,
  userId: string,
): Promise<MembershipRecord | null> {
  const rows = await scope.tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, scope.tenantId),
        eq(memberships.userId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function isInstructorOf(
  scope: TenantScope,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const rows = await scope.tx
    .select({ ok: sql<number>`1` })
    .from(courseInstructors)
    .where(
      and(
        eq(courseInstructors.tenantId, scope.tenantId),
        eq(courseInstructors.userId, userId),
        eq(courseInstructors.courseId, courseId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Resolves both entitlement shapes in one query: a direct course enrollment,
 * or an enrollment in any program that contains the course. Expiry is applied
 * as `expires_at is null or expires_at > now()`, so a lapsed enrollment reads
 * exactly like no enrollment at all.
 */
export async function hasActiveEntitlement(
  scope: TenantScope,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const notExpired = or(
    isNull(enrollments.expiresAt),
    gt(enrollments.expiresAt, sql`now()`),
  );

  const coversCourseDirectly = and(
    eq(enrollments.sourceKind, 'course'),
    eq(enrollments.sourceId, courseId),
  );

  const coversCourseViaProgram = and(
    eq(enrollments.sourceKind, 'program'),
    exists(
      scope.tx
        .select({ ok: sql<number>`1` })
        .from(programCourses)
        .where(
          and(
            eq(programCourses.tenantId, scope.tenantId),
            eq(programCourses.programId, enrollments.sourceId),
            eq(programCourses.courseId, courseId),
          ),
        ),
    ),
  );

  const rows = await scope.tx
    .select({ ok: sql<number>`1` })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.userId, userId),
        notExpired,
        or(coversCourseDirectly, coversCourseViaProgram),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export type EnrollmentRecord = {
  id: string;
  sourceKind: 'program' | 'course';
  sourceId: string;
  expiresAt: Date | null;
  grantedBy: string | null;
};

export async function listEnrollments(
  scope: TenantScope,
  userId: string,
): Promise<EnrollmentRecord[]> {
  return scope.tx
    .select({
      id: enrollments.id,
      sourceKind: enrollments.sourceKind,
      sourceId: enrollments.sourceId,
      expiresAt: enrollments.expiresAt,
      grantedBy: enrollments.grantedBy,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.userId, userId),
      ),
    );
}
