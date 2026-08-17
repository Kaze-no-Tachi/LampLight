import { and, eq, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { courseInstructors, courses, lessons, modules } from '@/db/schema';
import { listResourcesForLessons } from '@/db/repositories/lessons';
import { requireViewer } from '@/lib/auth/guards';
import { TeachCourse } from './teach-course';

/**
 * What an instructor may edit (PRD requirement P0-10).
 *
 * The list is built from the same rule the write actions enforce, so the page
 * shows exactly what the predicate would allow rather than showing everything
 * and refusing on submit. An admin sees every course in their institute; an
 * instructor sees the ones they are assigned to and nothing else.
 *
 * A student reaching this URL gets the ordinary 404, because being signed in
 * is not the same as having anything to teach.
 */
export const dynamic = 'force-dynamic';

export default async function TeachPage() {
  const viewer = await requireViewer();

  if (viewer.role === 'student') notFound();

  const view = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const mine =
      viewer.role === 'admin'
        ? await scope.tx
            .select({ id: courses.id, title: courses.title })
            .from(courses)
            .where(eq(courses.tenantId, scope.tenantId))
            // Ordered, because a list of courses that shuffles between page
            // loads is disorienting for the person using it and makes any test
            // that says "the first course" quietly nondeterministic.
            .orderBy(courses.title)
        : await scope.tx
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
            .orderBy(courses.title);

    if (mine.length === 0) return [];

    const courseIds = mine.map((course) => course.id);

    const allModules = await scope.tx
      .select({
        id: modules.id,
        courseId: modules.courseId,
        title: modules.title,
      })
      .from(modules)
      .where(
        and(
          eq(modules.tenantId, scope.tenantId),
          inArray(modules.courseId, courseIds),
        ),
      )
      .orderBy(modules.sortOrder);

    const allLessons =
      allModules.length === 0
        ? []
        : await scope.tx
            .select({
              id: lessons.id,
              moduleId: lessons.moduleId,
              title: lessons.title,
              isFreePreview: lessons.isFreePreview,
            })
            .from(lessons)
            .where(
              and(
                eq(lessons.tenantId, scope.tenantId),
                inArray(
                  lessons.moduleId,
                  allModules.map((item) => item.id),
                ),
              ),
            )
            .orderBy(lessons.sortOrder);

    // Including the reserved rows, which is the difference between this and
    // what a student sees: an instructor whose upload failed has to be able to
    // see that it failed.
    const resources = await listResourcesForLessons(
      scope,
      allLessons.map((lesson) => lesson.id),
    );

    return mine.map((course) => ({
      ...course,
      modules: allModules
        .filter((item) => item.courseId === course.id)
        .map((item) => ({
          ...item,
          lessons: allLessons
            .filter((lesson) => lesson.moduleId === item.id)
            .map((lesson) => ({
              ...lesson,
              editable: true,
              recordings: resources
                .filter((resource) => resource.lessonId === lesson.id)
                .map((resource) => ({
                  id: resource.id,
                  filename: resource.filename,
                  byteSize: resource.byteSize,
                  isDownloadable: resource.isDownloadable,
                })),
            })),
        })),
    }));
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Teaching</h1>
        <p className="text-muted-foreground">
          {viewer.role === 'admin'
            ? 'Every course at this institute.'
            : 'The courses you are assigned to.'}
        </p>
      </header>

      {view.length === 0 ? (
        <p className="text-muted-foreground">
          You are not assigned to any courses yet. An admin can assign you.
        </p>
      ) : (
        view.map((course) => <TeachCourse key={course.id} course={course} />)
      )}
    </main>
  );
}
