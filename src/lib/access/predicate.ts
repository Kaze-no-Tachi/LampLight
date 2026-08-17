import { getTenantDb } from '@/db/client';
import {
  findMembership,
  hasActiveEntitlement,
  isInstructorOf,
} from '@/db/repositories/entitlements';
import { findLessonWithCourse } from '@/db/repositories/lessons';
import type { TenantScope } from '@/db/scope';

/**
 * THE ACCESS PREDICATE (PRD section 7, requirement P0-6).
 *
 * One function governs every read of gated content, and it is the only thing
 * allowed to authorise a signed media URL. That single-authority rule is the
 * whole design: the moment a second place decides who may hear a lecture, the
 * two disagree, and the disagreement is a student listening to a course they
 * did not buy or an institute's material reachable from another's domain.
 *
 * THE RULES THAT MUST NOT BE VIOLATED
 *
 * No route handler, server action, or URL signer queries entitlement tables
 * directly. They call this. `pnpm test` enforces the shape of it, and the one
 * caller that matters, signed media issuance, is asserted end to end.
 *
 * Denial is uniform. This returns a boolean and its callers render the same
 * 404 for every false, whatever produced it: wrong institute, no session, no
 * membership, expired enrollment, or a lesson that never existed. A 403 with
 * detail would let a student walk an institute's catalog through error codes.
 *
 * WHY IT TAKES A SCOPE RATHER THAN OPENING ITS OWN
 *
 * Callers usually need more than the yes or no: the lesson, its resources, the
 * course around it. Taking a TenantScope lets all of that happen in one
 * transaction against one consistent snapshot. `canAccessLesson` is the
 * convenience wrapper for callers that only want the answer.
 */

export type AccessContext = {
  readonly tenantId: string;
  /** Null for a visitor who is not signed in. Free previews still resolve. */
  readonly userId: string | null;
};

/**
 * Which branch granted access, for logging and for tests.
 *
 * Worth naming rather than returning a bare boolean, because "this student got
 * in because their program contains the course" and "this student got in
 * because they are an admin" are different facts, and a test that cannot tell
 * them apart passes when the predicate grants for the wrong reason.
 */
export type AccessGrant =
  'free-preview' | 'tenant-admin' | 'course-instructor' | 'entitlement';

export type AccessDecision =
  { allowed: true; reason: AccessGrant; courseId: string } | { allowed: false };

const DENIED: AccessDecision = { allowed: false };

/**
 * Decides whether this viewer may read this lesson, inside an existing scope.
 *
 * The branch order is the PRD's and is load bearing in one place: the free
 * preview check comes before the session check, so a lesson an institute marked
 * open is open to a visitor who has never signed in. Every other branch needs
 * an identity first.
 */
export async function decideLessonAccess(
  scope: TenantScope,
  ctx: AccessContext,
  lessonId: string,
): Promise<AccessDecision> {
  // 1. Tenant scope. A lesson belonging to another institute is not found,
  //    which is the same answer as a lesson that does not exist. The scope
  //    itself enforces this: the query is filtered and row-level security
  //    applies on top, so this is a check on the result rather than a check
  //    somebody could forget to write.
  // findLessonWithCourse hard-excludes an archived lesson for every branch
  // below, the same rule an archived course gets: gone for its own author too,
  // not only for students (round 2, chunk 3).
  const lesson = await findLessonWithCourse(scope, lessonId);
  if (!lesson) return DENIED;

  // 2. Free preview, open to everyone including visitors with no session.
  //    Draft is not "finished" even when marked free preview: a lesson an
  //    institute is still writing is not an invitation to the public, free
  //    preview or not.
  if (lesson.isFreePreview && lesson.isPublished) {
    return { allowed: true, reason: 'free-preview', courseId: lesson.courseId };
  }

  if (!ctx.userId) return DENIED;

  const membership = await findMembership(scope, ctx.userId);
  if (!membership) return DENIED;

  // 3. An institute's admins see everything of their institute's, published or
  //    not: managing a draft is exactly the point of being staff. Note that
  //    this is admin *here*: the membership was looked up in this tenant's
  //    scope, so an admin at another institute is nobody here.
  if (membership.role === 'admin') {
    return { allowed: true, reason: 'tenant-admin', courseId: lesson.courseId };
  }

  // 4. Instructors see the courses they are assigned to, and only those,
  //    drafts included for the same reason as admin. An instructor is not a
  //    lesser admin: they have no standing on a course somebody else teaches.
  if (
    membership.role === 'instructor' &&
    (await isInstructorOf(scope, ctx.userId, lesson.courseId))
  ) {
    return {
      allowed: true,
      reason: 'course-instructor',
      courseId: lesson.courseId,
    };
  }

  // 5 and 6. A direct unexpired course enrollment, or an enrollment in any
  //    program that contains this course. Both shapes resolve in one query,
  //    and an expired enrollment reads exactly like no enrollment at all.
  //    Published is required here too: an ordinary student's entitlement
  //    covers the course, not a lesson inside it that is still being written.
  if (
    lesson.isPublished &&
    (await hasActiveEntitlement(scope, ctx.userId, lesson.courseId))
  ) {
    return { allowed: true, reason: 'entitlement', courseId: lesson.courseId };
  }

  return DENIED;
}

/** The predicate, for callers that want only the answer. */
export async function canAccessLesson(
  ctx: AccessContext,
  lessonId: string,
): Promise<boolean> {
  const decision = await getTenantDb(ctx.tenantId).run((scope) =>
    decideLessonAccess(scope, ctx, lessonId),
  );
  return decision.allowed;
}
