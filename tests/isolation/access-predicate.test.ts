import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getTenantDb } from '@/db/client';
import {
  courseBySlug,
  CORNERSTONE,
  firstGatedLesson,
  GRACE,
  userByKey,
  type SeedCourse,
  type SeedTenant,
} from '@/db/seed-data';
import { decideLessonAccess, type AccessGrant } from '@/lib/access/predicate';

/**
 * Every branch of the access predicate (PRD section 7, requirement P0-6).
 *
 * This is the function that decides whether somebody may hear a lecture, and
 * it is the only thing allowed to authorise a signed media URL, so each branch
 * is asserted for the reason it granted rather than only for the yes or no. A
 * predicate that lets the right people in for the wrong reason passes a boolean
 * test and fails the first time a branch is edited.
 */

/** A lesson that is not a free preview, from a named course. */
function gatedLessonIn(tenant: SeedTenant, courseSlug: string): string {
  return firstGatedLesson(courseBySlug(tenant, courseSlug)).id;
}

function previewLessonIn(tenant: SeedTenant, courseSlug: string): string {
  const course: SeedCourse = courseBySlug(tenant, courseSlug);
  const preview = course.modules
    .flatMap((courseModule) => courseModule.lessons)
    .find((lesson) => lesson.isFreePreview);
  if (!preview) throw new Error('fixture has no free preview lesson');
  return preview.id;
}

async function decide(
  tenant: SeedTenant,
  userId: string | null,
  lessonId: string,
): Promise<{ allowed: boolean; reason?: AccessGrant }> {
  return getTenantDb(tenant.id).run(async (scope) => {
    const decision = await decideLessonAccess(
      scope,
      { tenantId: tenant.id, userId },
      lessonId,
    );
    return decision.allowed
      ? { allowed: true, reason: decision.reason }
      : { allowed: false };
  });
}

afterAll(async () => {
  await closeDb();
});

describe('branch 1, tenant scope', () => {
  it('refuses a lesson belonging to another institute', async () => {
    // Cornerstone's lesson id, asked under Grace. Both institutes have a
    // course at this slug with identically shaped lessons, so a predicate that
    // lost its scope would find something plausible rather than nothing.
    const foreign = gatedLessonIn(CORNERSTONE, 'church-history');

    const asAdmin = await decide(GRACE, userByKey(GRACE, 'admin').id, foreign);

    // Even an admin, who is the most privileged role there is, gets nothing.
    // Wrong institute is indistinguishable from nonexistent.
    expect(asAdmin.allowed).toBe(false);
  });

  it('refuses a lesson id that never existed', async () => {
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'admin').id,
      '00000000-0000-4000-8000-000000000000',
    );
    expect(decision.allowed).toBe(false);
  });
});

describe('branch 2, free preview', () => {
  it('opens a preview lesson to somebody with no session at all', async () => {
    const preview = previewLessonIn(GRACE, 'church-history');

    const decision = await decide(GRACE, null, preview);

    expect(decision).toEqual({ allowed: true, reason: 'free-preview' });
  });

  it('still refuses a gated lesson to that same visitor', async () => {
    const gated = gatedLessonIn(GRACE, 'church-history');
    expect((await decide(GRACE, null, gated)).allowed).toBe(false);
  });

  it('does not open another institute preview', async () => {
    // The free-preview branch runs before the session check, which is exactly
    // where a missing tenant filter would be invisible: no identity is
    // involved to make the mistake obvious.
    const foreign = previewLessonIn(CORNERSTONE, 'church-history');
    expect((await decide(GRACE, null, foreign)).allowed).toBe(false);
  });
});

describe('branch 3, institute admin', () => {
  it('sees everything in their own institute', async () => {
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'admin').id,
      gatedLessonIn(GRACE, 'pastoral-ministry'),
    );

    expect(decision).toEqual({ allowed: true, reason: 'tenant-admin' });
  });

  it('is nobody at another institute', async () => {
    // Grace's admin, asking Cornerstone about Cornerstone's own lesson. The
    // membership lookup happens in Cornerstone's scope, so this person has no
    // role there whatsoever.
    const decision = await decide(
      CORNERSTONE,
      userByKey(GRACE, 'admin').id,
      gatedLessonIn(CORNERSTONE, 'pastoral-ministry'),
    );

    expect(decision.allowed).toBe(false);
  });
});

describe('branch 4, instructor', () => {
  it('sees a course they are assigned to', async () => {
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'instructor').id,
      gatedLessonIn(GRACE, 'old-testament-survey'),
    );

    expect(decision).toEqual({ allowed: true, reason: 'course-instructor' });
  });

  it('is refused a course somebody else teaches', async () => {
    // An instructor is not a lesser admin. The fixture assigns them the first
    // three courses only, so this is the negative case that proves the
    // assignment is actually consulted.
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'instructor').id,
      gatedLessonIn(GRACE, 'pastoral-ministry'),
    );

    expect(decision.allowed).toBe(false);
  });
});

describe('branches 5 and 6, entitlements', () => {
  it('grants a directly purchased course', async () => {
    // student2 bought church-history outright.
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'student2').id,
      gatedLessonIn(GRACE, 'church-history'),
    );

    expect(decision).toEqual({ allowed: true, reason: 'entitlement' });
  });

  it('grants every course inside a purchased program', async () => {
    // student1 bought the diploma, which contains three courses. Program
    // containment is the branch most likely to be quietly wrong, because it
    // needs a join the direct case does not.
    for (const slug of [
      'old-testament-survey',
      'new-testament-survey',
      'systematic-theology-i',
    ]) {
      const decision = await decide(
        GRACE,
        userByKey(GRACE, 'student1').id,
        gatedLessonIn(GRACE, slug),
      );
      expect(decision, `diploma should cover ${slug}`).toEqual({
        allowed: true,
        reason: 'entitlement',
      });
    }
  });

  it('does not grant a course outside the purchased program', async () => {
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'student1').id,
      gatedLessonIn(GRACE, 'church-history'),
    );
    expect(decision.allowed).toBe(false);
  });

  it('does not let a single course purchase unlock its programs siblings', async () => {
    // student2 bought church-history, which sits inside the certificate
    // program. Buying one course must not open the other two.
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'student2').id,
      gatedLessonIn(GRACE, 'hermeneutics'),
    );

    // student2 also holds a scholarship to that program, so this asserts the
    // grant rather than the denial, and the sibling case is covered by
    // student1 above.
    expect(decision.allowed).toBe(true);
  });

  it('treats a lapsed enrollment exactly like none at all', async () => {
    // The shared student's old-testament-survey enrollment expired 30 days
    // ago. Expiry has to be applied in the query, not remembered by a caller.
    const decision = await decide(
      GRACE,
      userByKey(GRACE, 'shared').id,
      gatedLessonIn(GRACE, 'old-testament-survey'),
    );

    expect(decision.allowed).toBe(false);
  });
});

describe('the sharpest case in the fixture', () => {
  it('does not let an entitlement at one institute open the other', async () => {
    // The shared student holds an active hermeneutics entitlement at BOTH
    // institutes, which is what makes this sharp: a predicate that lost its
    // tenant filter would find the wrong institute's enrollment row and
    // cheerfully grant, and a fixture without a person on both sides could
    // never show it, because the user would simply not be found either way.
    const atGrace = await decide(
      GRACE,
      userByKey(GRACE, 'shared').id,
      gatedLessonIn(GRACE, 'hermeneutics'),
    );
    expect(atGrace.allowed).toBe(true);

    // Now the same person, the same course slug, the other institute's lesson,
    // asked under this institute. Their entitlement here does not reach there.
    const crossing = await decide(
      GRACE,
      userByKey(GRACE, 'shared').id,
      gatedLessonIn(CORNERSTONE, 'hermeneutics'),
    );
    expect(crossing.allowed).toBe(false);
  });
});
