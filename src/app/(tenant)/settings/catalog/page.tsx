import { getTenantDb } from '@/db/client';
import {
  listAssignableStaff,
  listCoursesForAdmin,
  listProgramsForAdmin,
} from '@/db/repositories/catalog-admin';
import { requireRole } from '@/lib/auth/guards';
import {
  CourseRow,
  NewCourseForm,
  NewProgramForm,
  ProgramRow,
} from './catalog-forms';

/**
 * The institute's catalogue: what it teaches, who teaches it, what is visible.
 *
 * THE GAP THIS FILLS. Everything downstream of a course could be edited and
 * nothing could be created. A freshly provisioned institute reached /teach and
 * was told an admin could assign them to a course, with no course to assign
 * and no way to make one, because courses existed only in the seed script.
 *
 * Admin rather than instructor, deliberately. Editing the content of a course
 * is the instructor's job and lives in /teach. Deciding that a course exists
 * at all, who is responsible for it, and whether students can see it, is the
 * institute's, and an instructor publishing their own half-built course is not
 * a decision they should be able to make alone.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Catalogue' };

export default async function CatalogPage() {
  const viewer = await requireRole('admin');

  const { courses, programs, staff } = await getTenantDb(viewer.tenant.id).run(
    async (scope) => ({
      courses: await listCoursesForAdmin(scope),
      programs: await listProgramsForAdmin(scope),
      staff: await listAssignableStaff(scope),
    }),
  );

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
        <p className="text-muted-foreground">
          Courses and programs, who teaches them, and whether students can see
          them. New courses start unpublished, so you can build one before
          anybody finds it.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Courses</h2>
        <NewCourseForm />

        {courses.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing yet. Create a course above, then add modules and lessons to
            it from Teaching.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {courses.map((course) => (
              <CourseRow key={course.id} course={course} staff={staff} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Programs</h2>
        <NewProgramForm />

        {programs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None yet. A program groups courses so somebody enrols once and gets
            all of them.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {programs.map((program) => (
              <ProgramRow
                key={program.id}
                program={program}
                courses={courses}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
