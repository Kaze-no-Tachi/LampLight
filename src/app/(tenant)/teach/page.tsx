import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import {
  countCourseEnrollments,
  listAssignableStaff,
  listCoursesForAdmin,
  listProgramsForAdmin,
} from '@/db/repositories/catalog-admin';
import { courseInstructors, courses } from '@/db/schema';
import { can } from '@/lib/access/can';
import { requireViewer } from '@/lib/auth/guards';
import { NewCourseForm } from './new-course-form';
import { NewProgramForm, ProgramRow } from './programs';
import { TeachCourse } from './teach-course';

/**
 * What an instructor may edit (PRD requirement P0-10), and what an admin
 * decides exists at all (round 2, chunk 5).
 *
 * The course list is built from the same rule the write actions enforce, so
 * the page shows exactly what the predicate would allow rather than showing
 * everything and refusing on submit. An admin sees every course in their
 * institute, plus the catalogue controls settings/catalog used to own
 * (create, publish, instructor assignment, and programs); an instructor sees
 * only the courses they are assigned to, and none of those controls.
 *
 * A student reaching this URL gets the ordinary 404, because being signed in
 * is not the same as having anything to teach. Decided by `can`, the single
 * vocabulary chunk 1 built for exactly this, rather than the inline role
 * comparison this page used to have (round 2, chunk 4).
 *
 * Course content itself, publishing a lesson, archiving, reordering: none of
 * that happens here. It happens at /courses/[courseId]/edit (chunk 3); this
 * page only points there.
 */
export const dynamic = 'force-dynamic';

export default async function TeachPage() {
  const viewer = await requireViewer();
  const isAdmin = viewer.role === 'admin';

  const verdict = await getTenantDb(viewer.tenant.id).run((scope) =>
    can(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId, role: viewer.role },
      'teach:view',
    ),
  );
  if (!verdict.allowed) notFound();

  const { courses: view, programs } = await getTenantDb(viewer.tenant.id).run(
    async (scope) => {
      if (isAdmin) {
        const [adminCourses, staff, adminPrograms] = await Promise.all([
          listCoursesForAdmin(scope),
          listAssignableStaff(scope),
          listProgramsForAdmin(scope),
        ]);

        const courseRows = await Promise.all(
          adminCourses.map(async (course) => ({
            id: course.id,
            title: course.title,
            enrolledCount: await countCourseEnrollments(scope, course.id),
            admin: {
              isPublished: course.isPublished,
              lessonCount: course.lessonCount,
              instructors: course.instructors,
              unassignedStaff: staff.filter(
                (person) =>
                  !course.instructors.some((i) => i.userId === person.userId),
              ),
            },
          })),
        );

        return {
          courses: courseRows,
          programs: { list: adminPrograms, courses: adminCourses },
        };
      }

      const mine = await scope.tx
        .select({ id: courses.id, title: courses.title })
        .from(courses)
        .innerJoin(
          courseInstructors,
          and(
            eq(courseInstructors.tenantId, courses.tenantId),
            eq(courseInstructors.courseId, courses.id),
          ),
        )
        .where(
          and(
            eq(courses.tenantId, scope.tenantId),
            eq(courseInstructors.userId, viewer.userId),
          ),
        )
        // Ordered, because a list of courses that shuffles between page loads
        // is disorienting for the person using it and makes any test that
        // says "the first course" quietly nondeterministic.
        .orderBy(courses.title);

      const courseRows = await Promise.all(
        mine.map(async (course) => ({
          id: course.id,
          title: course.title,
          enrolledCount: await countCourseEnrollments(scope, course.id),
        })),
      );

      return { courses: courseRows, programs: null };
    },
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Teaching</h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? 'Every course at this institute.'
            : 'The courses you are assigned to.'}
        </p>
      </header>

      {isAdmin && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Courses</h2>
          <NewCourseForm />
        </section>
      )}

      {view.length === 0 ? (
        <p className="text-muted-foreground">
          {isAdmin
            ? 'Nothing yet. Create a course above.'
            : 'You are not assigned to any courses yet. An admin can assign you.'}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {view.map((course) => (
            <TeachCourse key={course.id} course={course} />
          ))}
        </div>
      )}

      {programs && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Programs</h2>
          <NewProgramForm />

          {programs.list.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              None yet. A program groups courses so somebody enrols once and
              gets all of them.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {programs.list.map((program) => (
                <ProgramRow
                  key={program.id}
                  program={program}
                  courses={programs.courses}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
