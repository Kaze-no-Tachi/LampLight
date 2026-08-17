import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import { listCourseResources } from '@/db/repositories/catalog';
import { courses, lessons, modules } from '@/db/schema';
import { decideCourseAuthoring } from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import { CourseEditor } from './course-editor';

/**
 * Editing one course: what it says, and what comes with it.
 *
 * A page rather than a panel on the teaching list, because a description is a
 * few paragraphs and a syllabus is a file, and both deserve more than a row in
 * a list. The list is for finding things; this is for working on one.
 *
 * The predicate decides, not the route. An instructor who types a course id
 * they are not assigned to gets the same 404 as one that does not exist.
 */
export const dynamic = 'force-dynamic';

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const viewer = await requireViewer();
  const { courseId } = await params;

  const data = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return null;

    const [course] = await scope.tx
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        descriptionMd: courses.descriptionMd,
      })
      .from(courses)
      .where(
        and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)),
      )
      .limit(1);

    if (!course) return null;

    const courseModules = await scope.tx
      .select({ id: modules.id, title: modules.title })
      .from(modules)
      .where(
        and(
          eq(modules.tenantId, scope.tenantId),
          eq(modules.courseId, courseId),
        ),
      )
      .orderBy(modules.sortOrder);

    const courseLessons =
      courseModules.length === 0
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
                  courseModules.map((item) => item.id),
                ),
              ),
            )
            .orderBy(lessons.sortOrder);

    return {
      course,
      modules: courseModules.map((item) => ({
        ...item,
        lessons: courseLessons.filter((lesson) => lesson.moduleId === item.id),
      })),
      resources: await listCourseResources(scope, courseId),
    };
  });

  if (!data) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link
          href="/teach"
          className="text-muted-foreground text-sm hover:underline"
        >
          Back to teaching
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.course.title}
        </h1>
        <Link
          href={`/courses/${data.course.slug}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          See what students see
        </Link>
      </div>

      <CourseEditor
        course={data.course}
        resources={data.resources.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          title: resource.title,
          isPublic: resource.isPublic,
          filename: resource.filename,
          url: resource.url,
        }))}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Lessons</h2>
        {data.modules.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No sections yet. Add one from the teaching page.
          </p>
        ) : (
          data.modules.map((courseModule) => (
            <div key={courseModule.id} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{courseModule.title}</h3>
              <ul className="flex flex-col">
                {courseModule.lessons.map((lesson) => (
                  <li key={lesson.id} className="border-b py-2 last:border-b-0">
                    <Link
                      href={`/teach/lessons/${lesson.id}`}
                      className="flex flex-wrap items-center gap-3 text-sm"
                    >
                      <span className="underline-offset-4 hover:underline">
                        {lesson.title}
                      </span>
                      {lesson.isFreePreview && (
                        <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
                          Free preview
                        </span>
                      )}
                      <span className="text-muted-foreground ml-auto text-xs">
                        Edit
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
