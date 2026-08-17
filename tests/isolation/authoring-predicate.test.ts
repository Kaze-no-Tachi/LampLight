import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import {
  courseBySlug,
  CORNERSTONE,
  firstGatedLesson,
  GRACE,
  userByKey,
  type SeedTenant,
} from '@/db/seed-data';
import { courses } from '@/db/schema';
import {
  decideCourseAuthoring,
  decideLessonAuthoring,
  decideModuleAuthoring,
  type AuthorGrant,
} from '@/lib/access/authoring';
import { withScope } from '../helpers/scope';

/**
 * Who may change content (PRD requirement P0-10).
 *
 * The case worth the most attention is not the obvious one. An instructor at
 * the right institute, editing a course somebody else teaches, passes every
 * check an ordinary role guard would make: real session, real membership,
 * staff role, correct tenant. Only the assignment says no, so that is the
 * assertion this file exists for.
 */

const ASSIGNED = 'old-testament-survey';
const NOT_ASSIGNED = 'pastoral-ministry';

async function decideCourse(
  tenant: SeedTenant,
  userKey: string,
  courseSlug: string,
  atTenant: SeedTenant = tenant,
): Promise<{ allowed: boolean; reason?: AuthorGrant }> {
  const courseId = courseBySlug(atTenant, courseSlug).id;

  return getTenantDb(tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: tenant.id, userId: userByKey(tenant, userKey).id },
      courseId,
    );
    return decision.allowed
      ? { allowed: true, reason: decision.reason }
      : { allowed: false };
  });
}

afterEach(async () => {
  // Back to what the seed says, for every other test in this file and every
  // other file sharing the database.
  await getAdminDb()
    .update(courses)
    .set({ archivedAt: null })
    .where(eq(courses.id, courseBySlug(GRACE, ASSIGNED).id));
});

afterAll(async () => {
  await closeDb();
});

describe('an archived course', () => {
  it('is refused to its own admin and its own assigned instructor', async () => {
    // Round 2, chunk 3. Archiving is hidden from its own author too, not only
    // from students, the same rule an archived lesson gets: an archived
    // course is not something you keep editing, it is gone.
    await getAdminDb()
      .update(courses)
      .set({ archivedAt: new Date() })
      .where(eq(courses.id, courseBySlug(GRACE, ASSIGNED).id));

    expect(await decideCourse(GRACE, 'admin', ASSIGNED)).toEqual({
      allowed: false,
    });
    expect(await decideCourse(GRACE, 'instructor', ASSIGNED)).toEqual({
      allowed: false,
    });
  });
});

describe('an instructor edits their own courses and no others', () => {
  it('may edit a course they are assigned to', async () => {
    expect(await decideCourse(GRACE, 'instructor', ASSIGNED)).toEqual({
      allowed: true,
      reason: 'course-instructor',
    });
  });

  it('may not edit a colleague course at the same institute', async () => {
    // THE CASE THIS FILE EXISTS FOR. Real session, real membership, staff
    // role, correct institute. Everything an ordinary role guard checks says
    // yes, and only the assignment says no.
    expect(await decideCourse(GRACE, 'instructor', NOT_ASSIGNED)).toEqual({
      allowed: false,
    });
  });

  it('may not edit a course at another institute', async () => {
    // Grace's instructor, asking Grace about Cornerstone's course id. The
    // course does not exist here, which is the same answer as never existing.
    expect(
      await decideCourse(GRACE, 'instructor', ASSIGNED, CORNERSTONE),
    ).toEqual({ allowed: false });
  });
});

describe('an admin edits anything of their own institute', () => {
  it('may edit a course no instructor is assigned to', async () => {
    expect(await decideCourse(GRACE, 'admin', NOT_ASSIGNED)).toEqual({
      allowed: true,
      reason: 'tenant-admin',
    });
  });

  it('is nobody at another institute', async () => {
    expect(await decideCourse(GRACE, 'admin', ASSIGNED, CORNERSTONE)).toEqual({
      allowed: false,
    });
  });
});

describe('a student never edits, whatever they bought', () => {
  it('refuses the very course they purchased', async () => {
    // Reading and writing are different questions, which is why they are
    // different predicates. student1 holds an entitlement to this course and
    // can hear every lesson in it; that confers nothing here.
    expect(await decideCourse(GRACE, 'student1', ASSIGNED)).toEqual({
      allowed: false,
    });
  });
});

describe('resolving through the hierarchy', () => {
  it('checks a module against the course it actually belongs to', async () => {
    const assigned = courseBySlug(GRACE, ASSIGNED);
    const foreign = courseBySlug(GRACE, NOT_ASSIGNED);

    const assignedModule = assigned.modules[0];
    const foreignModule = foreign.modules[0];
    if (!assignedModule || !foreignModule) throw new Error('fixture');

    const instructor = userByKey(GRACE, 'instructor').id;

    const allowed = await getTenantDb(GRACE.id).run((scope) =>
      decideModuleAuthoring(
        scope,
        { tenantId: GRACE.id, userId: instructor },
        assignedModule.id,
      ),
    );
    expect(allowed.allowed).toBe(true);

    // The id that gets checked is the one the row belongs to, not one the
    // caller supplied alongside it, so passing a module from a course they do
    // not teach cannot be paired with a course id they do.
    const refused = await getTenantDb(GRACE.id).run((scope) =>
      decideModuleAuthoring(
        scope,
        { tenantId: GRACE.id, userId: instructor },
        foreignModule.id,
      ),
    );
    expect(refused.allowed).toBe(false);
  });

  it('checks a lesson through its module to its course', async () => {
    const instructor = userByKey(GRACE, 'instructor').id;

    const allowed = await getTenantDb(GRACE.id).run((scope) =>
      decideLessonAuthoring(
        scope,
        { tenantId: GRACE.id, userId: instructor },
        firstGatedLesson(courseBySlug(GRACE, ASSIGNED)).id,
      ),
    );
    expect(allowed.allowed).toBe(true);

    const refused = await getTenantDb(GRACE.id).run((scope) =>
      decideLessonAuthoring(
        scope,
        { tenantId: GRACE.id, userId: instructor },
        firstGatedLesson(courseBySlug(GRACE, NOT_ASSIGNED)).id,
      ),
    );
    expect(refused.allowed).toBe(false);
  });

  it('refuses a lesson from another institute', async () => {
    const refused = await getTenantDb(GRACE.id).run((scope) =>
      decideLessonAuthoring(
        scope,
        { tenantId: GRACE.id, userId: userByKey(GRACE, 'admin').id },
        firstGatedLesson(courseBySlug(CORNERSTONE, ASSIGNED)).id,
      ),
    );
    expect(refused.allowed).toBe(false);
  });
});

describe('the application layer refuses on its own', () => {
  /**
   * Everything above runs with both layers active, so row-level security sits
   * underneath every query and could be covering for the application layer.
   * These run the same decisions against the RLS-bypassing connection, which
   * is what a superadmin route, a migration, or a self-hoster with one
   * connection string actually has. The only thing left between the caller and
   * another institute's rows is the filters in the code.
   *
   * A finding worth recording, because it is not what I first assumed.
   * Deleting the tenant filter from the module or lesson lookup does not fail
   * any test here, and that is correct rather than a gap. Those lookups only
   * produce a course id, and decideCourseAuthoring then checks that the course
   * exists in this institute, so a foreign module resolves to a foreign course
   * and is refused there. Removing THAT check fails immediately.
   *
   * So the tenant filters on the intermediate lookups are defence in depth and
   * the course check is the load-bearing one. Both are worth keeping, and it
   * is worth knowing which is which: the next person to "simplify" this needs
   * to know that the redundant-looking filter is the cheap one and the check
   * that looks like a mere existence test is the boundary.
   */
  it('refuses a foreign module with the database not helping', async () => {
    const foreignModule = courseBySlug(CORNERSTONE, ASSIGNED).modules[0];
    if (!foreignModule) throw new Error('fixture');

    const decision = await withScope('app-layer-only', GRACE.id, (scope) =>
      decideModuleAuthoring(
        scope,
        { tenantId: GRACE.id, userId: userByKey(GRACE, 'admin').id },
        foreignModule.id,
      ),
    );

    expect(decision.allowed).toBe(false);
  });

  it('refuses a foreign lesson with the database not helping', async () => {
    const decision = await withScope('app-layer-only', GRACE.id, (scope) =>
      decideLessonAuthoring(
        scope,
        { tenantId: GRACE.id, userId: userByKey(GRACE, 'admin').id },
        firstGatedLesson(courseBySlug(CORNERSTONE, ASSIGNED)).id,
      ),
    );

    expect(decision.allowed).toBe(false);
  });

  it('refuses a foreign course with the database not helping', async () => {
    const decision = await withScope('app-layer-only', GRACE.id, (scope) =>
      decideCourseAuthoring(
        scope,
        { tenantId: GRACE.id, userId: userByKey(GRACE, 'admin').id },
        courseBySlug(CORNERSTONE, ASSIGNED).id,
      ),
    );

    expect(decision.allowed).toBe(false);
  });
});
