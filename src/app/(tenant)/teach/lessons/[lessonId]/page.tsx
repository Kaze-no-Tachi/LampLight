import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import {
  findLessonWithCourse,
  listResourcesForLessons,
} from '@/db/repositories/lessons';
import { decideCourseAuthoring } from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import { LessonEditor } from './lesson-editor';

/**
 * Editing one lesson: its title, its notes, whether it is open to everyone,
 * and what is attached to it.
 *
 * The authoring check runs against the lesson's course, which is where the
 * assignment lives. Reading the lesson first and then deciding would be the
 * wrong order only if the read leaked something, and it does not: the lookup
 * is tenant scoped, so a lesson at another institute is already invisible.
 */
export const dynamic = 'force-dynamic';

export default async function EditLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const viewer = await requireViewer();
  const { lessonId } = await params;

  const data = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const lesson = await findLessonWithCourse(scope, lessonId);
    if (!lesson) return null;

    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      lesson.courseId,
    );
    if (!decision.allowed) return null;

    return {
      lesson,
      resources: await listResourcesForLessons(scope, [lessonId]),
    };
  });

  if (!data) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link
          href={`/teach/courses/${data.lesson.courseId}`}
          className="text-muted-foreground text-sm hover:underline"
        >
          Back to {data.lesson.courseTitle}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.lesson.title}
        </h1>
        <Link
          href={`/lessons/${data.lesson.id}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          See what students see
        </Link>
      </div>

      <LessonEditor
        lesson={{
          id: data.lesson.id,
          title: data.lesson.title,
          contentMd: data.lesson.contentMd,
          isFreePreview: data.lesson.isFreePreview,
          durationSeconds: data.lesson.durationSeconds,
        }}
        resources={data.resources.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          filename: resource.filename,
          byteSize: resource.byteSize,
        }))}
      />
    </main>
  );
}
