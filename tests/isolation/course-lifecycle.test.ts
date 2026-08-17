import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import {
  countCourseEnrollments,
  listCoursesForAdmin,
} from '@/db/repositories/catalog-admin';
import { listPublishedCourses } from '@/db/repositories/catalog';
import { listLessonsForCourse } from '@/db/repositories/lessons';
import { courses, lessons, modules, products } from '@/db/schema';
import {
  courseBySlug,
  CORNERSTONE,
  firstGatedLesson,
  GRACE,
} from '@/db/seed-data';
import {
  archiveCourse,
  archiveLesson,
  createCourse,
  reorderLesson,
  setCoursePublished,
  setLessonPublished,
} from '@/lib/catalog/authoring';

/**
 * Course and lesson lifecycle (round 2, chunk 3): archiving a course frees
 * its slug, archiving or publishing a lesson, and reordering within a
 * module.
 *
 * Course creation had no isolation coverage at all before this file, only
 * the browser suite (tests/e2e/catalog.spec.ts). These use `createCourse` to
 * make disposable fixtures rather than touching the seed, and clean up by
 * id, matching the standing rule elsewhere in this suite.
 */

const created = new Set<string>();

async function makeCourse(slug: string): Promise<string> {
  const outcome = await getTenantDb(GRACE.id).run((scope) =>
    createCourse(scope, { title: slug, slug }),
  );
  if (outcome.status !== 'ok') throw new Error(outcome.message);
  created.add(outcome.id);
  return outcome.id;
}

async function cleanup(): Promise<void> {
  if (created.size === 0) return;
  const ids = [...created];

  const rows = await getAdminDb()
    .select({ productId: courses.productId })
    .from(courses)
    .where(inArray(courses.id, ids));

  await getAdminDb().delete(courses).where(inArray(courses.id, ids));

  const productIds = rows.map((row) => row.productId);
  if (productIds.length > 0) {
    await getAdminDb().delete(products).where(inArray(products.id, productIds));
  }

  created.clear();
}

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await closeDb();
});

describe('archiving a course', () => {
  it('takes it off the admin list and the public one', async () => {
    const courseId = await makeCourse(`archive-admin-list-${Date.now()}`);
    await getTenantDb(GRACE.id).run((scope) =>
      setCoursePublished(scope, courseId, true),
    );

    const before = await getTenantDb(GRACE.id).run(async (scope) => ({
      admin: await listCoursesForAdmin(scope),
      published: await listPublishedCourses(scope),
    }));
    expect(before.admin.map((c) => c.id)).toContain(courseId);
    expect(before.published.map((c) => c.id)).toContain(courseId);

    const outcome = await getTenantDb(GRACE.id).run((scope) =>
      archiveCourse(scope, courseId),
    );
    expect(outcome.status).toBe('ok');

    const after = await getTenantDb(GRACE.id).run(async (scope) => ({
      admin: await listCoursesForAdmin(scope),
      published: await listPublishedCourses(scope),
    }));
    expect(after.admin.map((c) => c.id)).not.toContain(courseId);
    expect(after.published.map((c) => c.id)).not.toContain(courseId);
  });

  it('frees the slug for a new course to take', async () => {
    const slug = `retiring-course-${Date.now()}`;
    const first = await makeCourse(slug);

    // THE ONE THAT MATTERS. Before archiving, the address is taken twice
    // over: once by application and once by the partial index.
    const blocked = await getTenantDb(GRACE.id).run((scope) =>
      createCourse(scope, { title: 'Duplicate', slug }),
    );
    expect(blocked.status).toBe('error');

    const archived = await getTenantDb(GRACE.id).run((scope) =>
      archiveCourse(scope, first),
    );
    expect(archived.status).toBe('ok');

    const reused = await getTenantDb(GRACE.id).run((scope) =>
      createCourse(scope, { title: 'Reissued', slug }),
    );
    expect(reused.status).toBe('ok');
    if (reused.status === 'ok') created.add(reused.id);
  });

  it('answers not_found for a course belonging to another institute', async () => {
    const foreign = courseBySlug(CORNERSTONE, 'church-history').id;
    const outcome = await getTenantDb(GRACE.id).run((scope) =>
      archiveCourse(scope, foreign),
    );
    expect(outcome.status).toBe('not_found');

    const [survivor] = await getAdminDb()
      .select({ archivedAt: courses.archivedAt })
      .from(courses)
      .where(eq(courses.id, foreign));
    expect(survivor?.archivedAt).toBeNull();
  });
});

describe('publishing and archiving a lesson', () => {
  it('toggles is_published independently of is_free_preview', async () => {
    const lessonId = firstGatedLesson(
      courseBySlug(GRACE, 'old-testament-survey'),
    ).id;

    const published = await getTenantDb(GRACE.id).run((scope) =>
      setLessonPublished(scope, lessonId, false),
    );
    expect(published.status).toBe('ok');

    const [row] = await getAdminDb()
      .select({
        isPublished: lessons.isPublished,
        isFreePreview: lessons.isFreePreview,
      })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(row?.isPublished).toBe(false);
    expect(row?.isFreePreview).toBe(false);

    // Restore, since this is a seeded lesson and other files depend on it
    // reading published.
    await getTenantDb(GRACE.id).run((scope) =>
      setLessonPublished(scope, lessonId, true),
    );
  });

  it('archiving removes it from the course listing', async () => {
    const courseId = await makeCourse(`archive-lesson-${Date.now()}`);
    const lessonId = await addLesson(courseId);

    const before = await getTenantDb(GRACE.id).run((scope) =>
      listLessonsForCourse(scope, courseId, { includeUnpublished: true }),
    );
    expect(before.map((lesson) => lesson.id)).toContain(lessonId);

    const outcome = await getTenantDb(GRACE.id).run((scope) =>
      archiveLesson(scope, lessonId),
    );
    expect(outcome.status).toBe('ok');

    const after = await getTenantDb(GRACE.id).run((scope) =>
      listLessonsForCourse(scope, courseId, { includeUnpublished: true }),
    );
    expect(after.map((lesson) => lesson.id)).not.toContain(lessonId);
  });
});

describe('reordering a lesson', () => {
  it('swaps sort_order with the neighbour and stops at the edge', async () => {
    const courseId = await makeCourse(`reorder-${Date.now()}`);
    const first = await addLesson(courseId, 0);
    const second = await addLesson(courseId, 1);
    const third = await addLesson(courseId, 2);

    // The middle one moves up: first and second trade places.
    const moved = await getTenantDb(GRACE.id).run((scope) =>
      reorderLesson(scope, second, 'up'),
    );
    expect(moved.status).toBe('ok');

    const order = await getTenantDb(GRACE.id).run((scope) =>
      listLessonsForCourse(scope, courseId, { includeUnpublished: true }),
    );
    expect(order.map((lesson) => lesson.id)).toEqual([second, first, third]);

    // Now at the front. Nothing above it to swap with.
    const edge = await getTenantDb(GRACE.id).run((scope) =>
      reorderLesson(scope, second, 'up'),
    );
    expect(edge.status).toBe('edge');
  });

  it('answers not_found for a lesson at another institute', async () => {
    const foreign = firstGatedLesson(
      courseBySlug(CORNERSTONE, 'church-history'),
    ).id;
    const outcome = await getTenantDb(GRACE.id).run((scope) =>
      reorderLesson(scope, foreign, 'down'),
    );
    expect(outcome.status).toBe('not_found');
  });
});

describe('countCourseEnrollments', () => {
  it('is zero for a course nobody holds', async () => {
    const courseId = await makeCourse(`empty-enrolments-${Date.now()}`);
    const count = await getTenantDb(GRACE.id).run((scope) =>
      countCourseEnrollments(scope, courseId),
    );
    expect(count).toBe(0);
  });

  it('counts the seeded direct enrolment and nothing from a program', async () => {
    // student1 holds three courses through the diploma program and none of
    // them directly, so the program-derived entitlement must not appear
    // here: this counts rows naming the course by id, not everyone who can
    // open it. new-testament-survey rather than old-testament-survey: only
    // the latter is a target manual-enrollment.test.ts temporarily grants a
    // direct enrolment to, and these files can run concurrently.
    const viaProgram = courseBySlug(GRACE, 'new-testament-survey').id;
    const direct = courseBySlug(GRACE, 'church-history').id;

    const counts = await getTenantDb(GRACE.id).run(async (scope) => ({
      viaProgram: await countCourseEnrollments(scope, viaProgram),
      direct: await countCourseEnrollments(scope, direct),
    }));

    expect(counts.viaProgram).toBe(0);
    expect(counts.direct).toBe(1);
  });
});

/** Adds a lesson directly, bypassing the server action layer this test does not need. */
async function addLesson(courseId: string, sortOrder = 0): Promise<string> {
  return getTenantDb(GRACE.id).run(async (scope) => {
    const [courseModule] = await getAdminDb()
      .select({ id: modules.id })
      .from(modules)
      .where(
        and(eq(modules.tenantId, GRACE.id), eq(modules.courseId, courseId)),
      )
      .limit(1);
    if (!courseModule) throw new Error('fixture has no module');

    const [lesson] = await scope.tx
      .insert(lessons)
      .values({
        tenantId: scope.tenantId,
        moduleId: courseModule.id,
        title: `Lesson ${sortOrder}`,
        slug: `lesson-${sortOrder}`,
        isPublished: true,
        sortOrder,
      })
      .returning({ id: lessons.id });
    if (!lesson) throw new Error('could not create the fixture lesson');
    return lesson.id;
  });
}
