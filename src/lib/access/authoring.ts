import { and, eq } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import { findMembership, isInstructorOf } from '@/db/repositories/entitlements';
import { courses, lessons, modules } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Who may CHANGE content, as opposed to who may read it
 * (PRD requirement P0-10).
 *
 * A separate predicate from src/lib/access/predicate.ts, deliberately, because
 * they answer different questions and collapsing them gets one of the two
 * wrong. Reading has a free-preview branch and an entitlement branch, neither
 * of which has any business granting a write: a student who bought a course
 * must not be able to edit it, and a lesson marked as a free preview is not an
 * invitation for the public to rewrite it.
 *
 * What they share is the shape. One function is the authority, denial is
 * uniform 404, and no route or server action reaches past it to the tables.
 *
 * THE CASE AN ORDINARY ROLE CHECK MISSES
 *
 * An instructor is not a lesser admin. They may edit the courses they are
 * assigned to and nothing else, so `role === 'instructor'` is not sufficient
 * anywhere: the assignment has to be consulted every time. That is the check
 * most likely to be skipped, because the person is plainly staff and plainly
 * at the right institute, and it is the difference between an institute's
 * teachers editing their own courses and editing each other's.
 */

export type AuthorContext = {
  readonly tenantId: string;
  readonly userId: string;
};

export type AuthorGrant = 'tenant-admin' | 'course-instructor';

export type AuthorDecision =
  { allowed: true; reason: AuthorGrant } | { allowed: false };

const DENIED: AuthorDecision = { allowed: false };

/** May this person change this course, or anything hanging off it? */
export async function decideCourseAuthoring(
  scope: TenantScope,
  ctx: AuthorContext,
  courseId: string,
): Promise<AuthorDecision> {
  // The course has to exist in THIS institute. Checked first, so a course id
  // from elsewhere is refused before any role is considered and the answer is
  // identical to one that never existed.
  const found = await scope.tx
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)))
    .limit(1);
  if (found.length === 0) return DENIED;

  const membership = await findMembership(scope, ctx.userId);
  if (!membership) return DENIED;

  if (membership.role === 'admin') {
    return { allowed: true, reason: 'tenant-admin' };
  }

  if (
    membership.role === 'instructor' &&
    (await isInstructorOf(scope, ctx.userId, courseId))
  ) {
    return { allowed: true, reason: 'course-instructor' };
  }

  // Students land here, including students who bought this very course.
  // Buying a thing does not confer the right to change it.
  return DENIED;
}

/**
 * The same question asked about a module, resolved to its course first.
 *
 * Callers hold a module id, not a course id, and resolving it inside the same
 * scope is what stops a caller passing a module from one course and a course
 * id from another. The id that gets checked is the one the row actually
 * belongs to, not the one the request claimed.
 */
export async function decideModuleAuthoring(
  scope: TenantScope,
  ctx: AuthorContext,
  moduleId: string,
): Promise<AuthorDecision> {
  const rows = await scope.tx
    .select({ courseId: modules.courseId })
    .from(modules)
    .where(and(eq(modules.tenantId, scope.tenantId), eq(modules.id, moduleId)))
    .limit(1);

  const courseId = rows[0]?.courseId;
  if (!courseId) return DENIED;

  return decideCourseAuthoring(scope, ctx, courseId);
}

/** And about a lesson, resolved through its module to its course. */
export async function decideLessonAuthoring(
  scope: TenantScope,
  ctx: AuthorContext,
  lessonId: string,
): Promise<AuthorDecision> {
  const rows = await scope.tx
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.tenantId, lessons.tenantId),
        eq(modules.id, lessons.moduleId),
      ),
    )
    .where(and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, lessonId)))
    .limit(1);

  const courseId = rows[0]?.courseId;
  if (!courseId) return DENIED;

  return decideCourseAuthoring(scope, ctx, courseId);
}

/** Convenience wrapper for callers that only want the answer. */
export async function canAuthorCourse(
  ctx: AuthorContext,
  courseId: string,
): Promise<boolean> {
  const decision = await getTenantDb(ctx.tenantId).run((scope) =>
    decideCourseAuthoring(scope, ctx, courseId),
  );
  return decision.allowed;
}
