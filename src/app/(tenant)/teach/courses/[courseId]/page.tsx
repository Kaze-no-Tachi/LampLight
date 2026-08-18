import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import { countCourseEnrollments } from '@/db/repositories/catalog-admin';
import { listCourseResources } from '@/db/repositories/catalog';
import { listLessonsForCourse } from '@/db/repositories/lessons';
import { courses, modules } from '@/db/schema';
import { decideCourseAuthoring } from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import type { StaffModule } from '../../../lesson-list';
import { LessonList } from '../../../lesson-list';
import { AddLessonDialog } from './add-lesson-dialog';
import { ArchiveCourseButton } from './archive-course-button';
import { CourseEditor } from './course-editor';

/**
 * The one editor (round 2, chunk 3): a course's description and syllabus,
 * and every one of its lessons, in the place a course is created and the
 * place it is worked on afterwards.
 *
 * Replaces `/teach/courses/[courseId]`, which round 2 chunk 5 deleted once
 * nothing linked to it any more. This is the only place a course gets edited.
 *
 * The predicate decides, not the route. An instructor who types a course id
 * they are not assigned to, or an id that is archived, gets the same 404 as
 * one that does not exist.
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

    // Drafts included, staff sees them; archived is never included, hidden
    // from an author the same way it is hidden from a student.
    const lessons = await listLessonsForCourse(scope, courseId, {
      includeUnpublished: true,
    });

    const staffModules: StaffModule[] = courseModules.map((courseModule) => {
      const inModule = lessons.filter(
        (lesson) => lesson.moduleId === courseModule.id,
      );
      return {
        id: courseModule.id,
        title: courseModule.title,
        lessons: inModule.map((lesson, index) => ({
          id: lesson.id,
          title: lesson.title,
          isFreePreview: lesson.isFreePreview,
          isPublished: lesson.isPublished,
          durationSeconds: lesson.durationSeconds,
          isFirst: index === 0,
          isLast: index === inModule.length - 1,
        })),
      };
    });

    return {
      course,
      staffModules,
      resources: await listCourseResources(scope, courseId),
      enrolledCount: await countCourseEnrollments(scope, courseId),
      isAdmin: viewer.role === 'admin',
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
          href={`/catalogue/${data.course.slug}`}
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
          byteSize: resource.byteSize,
          filename: resource.filename,
          url: resource.url,
        }))}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Lessons</h2>

        <AddLessonDialog courseId={courseId} />

        <LessonList
          mode="staff"
          modules={data.staffModules}
          showModuleHeadings={data.staffModules.length > 1}
        />
      </section>

      {data.isAdmin && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-lg font-medium">Retire this course</h2>
          <p className="text-muted-foreground text-sm">
            Archiving takes it off the catalogue and every list, for good: there
            is no way back from here. Nothing is deleted, so anyone already
            enrolled keeps their record and their progress.
          </p>
          <ArchiveCourseButton
            courseId={data.course.id}
            courseTitle={data.course.title}
            enrolledCount={data.enrolledCount}
          />
        </section>
      )}
    </main>
  );
}
