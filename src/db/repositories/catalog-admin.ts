import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  courseInstructors,
  courses,
  enrollments,
  memberships,
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
