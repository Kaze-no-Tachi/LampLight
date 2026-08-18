import { and, asc, countDistinct, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  courseInstructors,
  courses,
  enrollments,
  lessonResources,
  lessons,
  memberships,
  modules,
  products,
  programCourses,
  programs,
  users,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * What an institute admin needs to see to manage a catalogue.
 *
 * Separate from src/db/repositories/courses.ts, which answers the student's
 * question ("what may I see"). These answer the admin's ("what exists, what
 * state is it in, and who is responsible for it"), so they deliberately show
 * unpublished courses and empty ones. A management screen that hides the
 * half-finished things is hiding exactly what the person came to work on.
 */

export type AdminCourse = {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  lessonCount: number;
  instructors: { userId: string; email: string; name: string }[];
};

export async function listCoursesForAdmin(
  scope: TenantScope,
): Promise<AdminCourse[]> {
  const rows = await scope.tx
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      isPublished: products.isPublished,
      lessonCount: sql<number>`(
        select count(*) from lessons l
        join modules m
          on m.tenant_id = l.tenant_id and m.id = l.module_id
        where l.tenant_id = ${scope.tenantId} and m.course_id = ${courses.id}
      )`,
    })
    .from(courses)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, courses.tenantId),
        eq(products.id, courses.productId),
      ),
    )
    // Archived disappears from every list, this one included: an admin
    // managing the catalogue should not keep tripping over a course they
    // already retired, any more than a student would.
    .where(
      and(eq(courses.tenantId, scope.tenantId), isNull(courses.archivedAt)),
    )
    .orderBy(asc(courses.title));

  if (rows.length === 0) return [];

  // One query for every assignment rather than one per course. A catalogue is
  // small, but a query inside a loop is a habit that stops being cheap exactly
  // when somebody finally has a lot of courses.
  const assignments = await scope.tx
    .select({
      courseId: courseInstructors.courseId,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(courseInstructors)
    .innerJoin(users, eq(users.id, courseInstructors.userId))
    .where(eq(courseInstructors.tenantId, scope.tenantId))
    .orderBy(asc(users.email));

  return rows.map((row) => ({
    ...row,
    lessonCount: Number(row.lessonCount),
    instructors: assignments
      .filter((entry) => entry.courseId === row.id)
      .map(({ userId, email, name }) => ({ userId, email, name })),
  }));
}

export type AdminProgram = {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  courseIds: string[];
};

export async function listProgramsForAdmin(
  scope: TenantScope,
): Promise<AdminProgram[]> {
  const rows = await scope.tx
    .select({
      id: programs.id,
      title: programs.title,
      slug: programs.slug,
      isPublished: products.isPublished,
    })
    .from(programs)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, programs.tenantId),
        eq(products.id, programs.productId),
      ),
    )
    .where(eq(programs.tenantId, scope.tenantId))
    .orderBy(asc(programs.title));

  if (rows.length === 0) return [];

  const links = await scope.tx
    .select({
      programId: programCourses.programId,
      courseId: programCourses.courseId,
    })
    .from(programCourses)
    .where(eq(programCourses.tenantId, scope.tenantId))
    .orderBy(asc(programCourses.sortOrder));

  return rows.map((row) => ({
    ...row,
    courseIds: links
      .filter((link) => link.programId === row.id)
      .map((link) => link.courseId),
  }));
}

/** Members who may be put in front of a course: staff, never students. */
export async function listAssignableStaff(scope: TenantScope): Promise<
  {
    userId: string;
    email: string;
    name: string;
    role: 'instructor' | 'admin';
  }[]
> {
  const rows = await scope.tx
    .select({
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, scope.tenantId))
    .orderBy(asc(users.email));

  return rows.filter(
    (row): row is (typeof rows)[number] & { role: 'instructor' | 'admin' } =>
      row.role !== 'student',
  );
}

/**
 * How many people directly hold this course, for the archive confirmation.
 *
 * Direct enrolments only, not entitlement resolved through a program: an
 * admin archiving a course is asking "who loses a row that names this course
 * by id", and a program enrolment does not. Archiving a course inside a live
 * program is a rarer, harder decision this count is not trying to answer.
 */
export async function countCourseEnrollments(
  scope: TenantScope,
  courseId: string,
): Promise<number> {
  const [row] = await scope.tx
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.sourceKind, 'course'),
        eq(enrollments.sourceId, courseId),
      ),
    );

  return Number(row?.count ?? 0);
}

export type CourseShape = {
  courseId: string;
  moduleCount: number;
  lessonCount: number;
  /**
   * Published, unarchived lessons with no audio attached. The number the
   * teaching list leads with, because it is the only thing on that screen that
   * is somebody's outstanding job.
   */
  awaitingAudio: number;
};

/**
 * The shape of each course: how many sections, how many lessons, and how many
 * of those are still waiting on a recording.
 *
 * Counts rather than the lessons themselves, deliberately. Modules and lessons
 * were moved off the teaching list into the course editor (round 2, chunk 3),
 * and reversing that would put a second editor on a screen that is meant to be
 * a list. A count still answers the question the list exists to answer, which
 * is which course needs attention next.
 *
 * Unpublished and archived lessons are excluded from the audio gap: a draft
 * nobody can hear yet is not waiting on anything, and chasing a recording for
 * a retired lesson is work nobody wants.
 */
export async function listCourseShapes(
  scope: TenantScope,
  courseIds: string[],
): Promise<CourseShape[]> {
  if (courseIds.length === 0) return [];

  const rows = await scope.tx
    .select({
      courseId: modules.courseId,
      moduleCount: countDistinct(modules.id),
      lessonCount: countDistinct(lessons.id),
      // Distinct over lesson ids so a lesson carrying two handouts and no
      // recording is counted once rather than twice.
      awaitingAudio: countDistinct(
        sql`case when ${lessonResources.id} is null then ${lessons.id} end`,
      ),
    })
    .from(modules)
    // Left throughout: a course with no sections, and a section with no
    // lessons, both belong on the teaching list. That is precisely the state
    // somebody opened the screen to fix.
    .leftJoin(
      lessons,
      and(
        eq(lessons.tenantId, scope.tenantId),
        eq(lessons.moduleId, modules.id),
        isNull(lessons.archivedAt),
        eq(lessons.isPublished, true),
      ),
    )
    .leftJoin(
      lessonResources,
      and(
        eq(lessonResources.tenantId, scope.tenantId),
        eq(lessonResources.lessonId, lessons.id),
        eq(lessonResources.kind, 'audio'),
      ),
    )
    .where(
      and(
        eq(modules.tenantId, scope.tenantId),
        inArray(modules.courseId, courseIds),
      ),
    )
    .groupBy(modules.courseId);

  return rows.map((row) => ({
    courseId: row.courseId,
    moduleCount: Number(row.moduleCount),
    lessonCount: Number(row.lessonCount),
    awaitingAudio: Number(row.awaitingAudio),
  }));
}
