import { and, eq } from 'drizzle-orm';
import { hasActiveEntitlement } from '@/db/repositories/entitlements';
import { courses, products } from '@/db/schema';
import type { TenantScope } from '@/db/scope';
import {
  decideCourseAuthoring,
  decideLessonAuthoring,
  type AuthorContext,
} from './authoring';
import { decideLessonAccess } from './predicate';

/**
 * One question, asked the same way everywhere: may this person do this?
 *
 * WHY A FACADE RATHER THAN A REWRITE
 *
 * The predicates underneath are the ones the isolation suite exercises branch
 * by branch, and their `reason` values are what let a test tell "granted
 * because they are an admin" apart from "granted because they bought it".
 * Replacing them with one flat function would throw that away to make the call
 * sites read nicer. So this delegates.
 *
 * What it adds is a single vocabulary. Before, a page asked
 * `decideCourseAuthoring`, an action asked `requireRole('admin')`, and one
 * page compared `viewer.role === 'student'` inline, so "who may publish"
 * had three answers depending on where you looked.
 *
 * HIDING A BUTTON IS NOT AUTHORIZATION. This is called twice on purpose: once
 * by the page, to decide what to render, and again by the server action, to
 * decide whether to do it. The second call is the one that matters; the first
 * exists so people are not shown controls that will refuse them.
 */

export type Actor = {
  readonly tenantId: string;
  /** Null for a visitor who is not signed in. */
  readonly userId: string | null;
  /** Null when they hold no membership at this institute. */
  readonly role: 'student' | 'instructor' | 'admin' | null;
};

export type Action =
  /** Bring a course into existence. Not about any particular course. */
  | 'course:create'
  /** Change a course's title, description, attachments, or its lessons. */
  | 'course:edit'
  /** Show it to the world, or take it back. */
  | 'course:publish'
  /** Retire it. Archive, never destroy. */
  | 'course:archive'
  /** Put themselves on it. */
  | 'course:enroll'
  /** Open a lesson's content and its media. */
  | 'lesson:view'
  | 'lesson:edit'
  | 'lesson:publish'
  | 'lesson:archive';

export type Resource =
  | { kind: 'course'; id: string }
  | { kind: 'lesson'; id: string }
  /** For actions that are not about a specific thing yet. */
  | { kind: 'none' };

export type Verdict =
  { allowed: true; reason: string } | { allowed: false; reason: string };

const NO_SESSION: Verdict = { allowed: false, reason: 'not-signed-in' };
const NOT_A_MEMBER: Verdict = { allowed: false, reason: 'not-a-member' };

function authorContext(actor: Actor): AuthorContext | null {
  if (!actor.userId) return null;
  return { tenantId: actor.tenantId, userId: actor.userId };
}

export async function can(
  scope: TenantScope,
  actor: Actor,
  action: Action,
  resource: Resource = { kind: 'none' },
): Promise<Verdict> {
  switch (action) {
    case 'course:create':
      // Deciding the institute teaches a thing at all is the institute's call.
      // An instructor edits what they are given.
      return actor.role === 'admin'
        ? { allowed: true, reason: 'tenant-admin' }
        : NOT_A_MEMBER;

    case 'course:publish':
    case 'course:archive':
      // Deliberately narrower than course:edit. An instructor writes the
      // course; whether students can see it, and whether it still exists, is
      // not theirs to decide alone.
      return actor.role === 'admin' && resource.kind === 'course'
        ? { allowed: true, reason: 'tenant-admin' }
        : NOT_A_MEMBER;

    case 'course:edit': {
      const ctx = authorContext(actor);
      if (!ctx) return NO_SESSION;
      if (resource.kind !== 'course') return NOT_A_MEMBER;

      const decision = await decideCourseAuthoring(scope, ctx, resource.id);
      return decision.allowed
        ? { allowed: true, reason: decision.reason }
        : { allowed: false, reason: 'not-an-author' };
    }

    case 'lesson:edit':
    case 'lesson:publish':
    case 'lesson:archive': {
      // All three resolve through the lesson's course, so an instructor
      // assigned to it may publish and retire its lessons. That is narrower
      // than it looks: it is their course, and the course's own visibility
      // still belongs to an admin.
      const ctx = authorContext(actor);
      if (!ctx) return NO_SESSION;
      if (resource.kind !== 'lesson') return NOT_A_MEMBER;

      const decision = await decideLessonAuthoring(scope, ctx, resource.id);
      return decision.allowed
        ? { allowed: true, reason: decision.reason }
        : { allowed: false, reason: 'not-an-author' };
    }

    case 'lesson:view': {
      if (resource.kind !== 'lesson') return NOT_A_MEMBER;

      // The only branch that works for a visitor with no session, because a
      // free preview is meant to. Everything else about it is the existing
      // six-branch predicate, unchanged.
      const decision = await decideLessonAccess(
        scope,
        { tenantId: actor.tenantId, userId: actor.userId },
        resource.id,
      );
      return decision.allowed
        ? { allowed: true, reason: decision.reason }
        : { allowed: false, reason: 'no-entitlement' };
    }

    case 'course:enroll': {
      if (!actor.userId) return NO_SESSION;
      if (!actor.role) return NOT_A_MEMBER;
      if (resource.kind !== 'course') return NOT_A_MEMBER;

      // Published and not archived, checked here rather than trusted from the
      // page that rendered the button. Self-enrolment onto a draft course
      // would be a way to read work in progress.
      const [course] = await scope.tx
        .select({
          isPublished: products.isPublished,
          archivedAt: courses.archivedAt,
        })
        .from(courses)
        .innerJoin(
          products,
          and(
            eq(products.tenantId, scope.tenantId),
            eq(products.id, courses.productId),
          ),
        )
        .where(
          and(
            eq(courses.tenantId, scope.tenantId),
            eq(courses.id, resource.id),
          ),
        )
        .limit(1);

      if (!course) return { allowed: false, reason: 'no-such-course' };
      if (course.archivedAt) return { allowed: false, reason: 'archived' };
      if (!course.isPublished)
        return { allowed: false, reason: 'not-published' };

      // Already on it is not a failure, but it is not an enrolment either, and
      // the caller needs to tell the difference to render the right button.
      // Through hasActiveEntitlement rather than a direct-course lookup, so a
      // student covered by a program that contains this course reads as
      // already entitled instead of being offered a second, redundant direct
      // enrolment for a course they can already open.
      const entitled = await hasActiveEntitlement(
        scope,
        actor.userId,
        resource.id,
      );

      return entitled
        ? { allowed: false, reason: 'already-enrolled' }
        : { allowed: true, reason: 'published-course' };
    }

    default:
      return { allowed: false, reason: 'unknown-action' };
  }
}

/** The boolean form, for deciding whether to render a control. */
export async function allowed(
  scope: TenantScope,
  actor: Actor,
  action: Action,
  resource: Resource = { kind: 'none' },
): Promise<boolean> {
  return (await can(scope, actor, action, resource)).allowed;
}
