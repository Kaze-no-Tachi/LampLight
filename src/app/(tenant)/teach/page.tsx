import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import {
  countCourseEnrollments,
  listAssignableStaff,
  listCourseShapes,
  listCoursesForAdmin,
  listProgramsForAdmin,
} from '@/db/repositories/catalog-admin';
import { courseInstructors, courses } from '@/db/schema';
import { can } from '@/lib/access/can';
import { requireViewer } from '@/lib/auth/guards';
import Link from 'next/link';
import { NewProgramForm, ProgramRow } from './programs';
import { TeachList } from './teach-list';

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

/**
 * A course with no sections yet produces no row in the aggregate at all, since
 * the query counts outward from modules. Zeroes rather than undefined, so the
 * card can say "0 sections" instead of breaking on a course somebody created
 * a minute ago.
 */
function shapeOf(
  row:
    | { moduleCount: number; lessonCount: number; awaitingAudio: number }
    | undefined,
): { moduleCount: number; lessonCount: number; awaitingAudio: number } {
  return row ?? { moduleCount: 0, lessonCount: 0, awaitingAudio: 0 };
}

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

        const shapes = new Map(
          (
            await listCourseShapes(
              scope,
              adminCourses.map((course) => course.id),
            )
          ).map((row) => [row.courseId, row]),
        );

        const courseRows = await Promise.all(
          adminCourses.map(async (course) => ({
            id: course.id,
            title: course.title,
            enrolledCount: await countCourseEnrollments(scope, course.id),
            shape: shapeOf(shapes.get(course.id)),
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

      const mineShapes = new Map(
        (
          await listCourseShapes(
            scope,
            mine.map((course) => course.id),
          )
        ).map((row) => [row.courseId, row]),
      );

      const courseRows = await Promise.all(
        mine.map(async (course) => ({
          id: course.id,
          title: course.title,
          enrolledCount: await countCourseEnrollments(scope, course.id),
          shape: shapeOf(mineShapes.get(course.id)),
        })),
      );

      return { courses: courseRows, programs: null };
    },
  );

  return (
    <div className="flex max-w-[1000px] flex-col gap-7">
      {/* The mockup's own header shape: the one thing an admin comes here to
          start sits on the title line, not below the list it would join. */}
      <header className="border-border flex flex-wrap items-end justify-between gap-5 border-b pb-[18px]">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-(length:--text-staff-page) leading-[1.2]">
            Teaching
          </h1>
          <p className="text-muted-foreground text-(length:--text-ui) leading-[1.6]">
            {isAdmin
              ? 'Every course at this institute.'
              : 'The courses you are assigned to.'}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/teach/courses/new"
            className="bg-primary text-primary-foreground rounded-(--radius) px-4 py-2.5 text-(length:--text-ui) font-medium"
          >
            New course
          </Link>
        )}
      </header>

      <section className="flex flex-col gap-[18px]">
        {view.length === 0 ? (
          <p className="text-muted-foreground text-(length:--text-ui)">
            {isAdmin
              ? 'Nothing yet. New course is the button above.'
              : 'You are not assigned to any courses yet. An admin can assign you.'}
          </p>
        ) : (
          <TeachList courses={view} isAdmin={isAdmin} />
        )}
      </section>

      {programs && (
        <section className="mt-6 flex flex-col gap-[18px]">
          <div className="border-border flex flex-wrap items-baseline justify-between gap-4 border-b pb-3">
            <h2 className="text-(length:--text-section) leading-tight">
              Programs
            </h2>
            <NewProgramForm />
          </div>

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
    </div>
  );
}
