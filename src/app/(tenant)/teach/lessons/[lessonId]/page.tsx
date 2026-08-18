import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import {
  findLessonWithCourse,
  listResourcesForLessons,
} from '@/db/repositories/lessons';
import { modules } from '@/db/schema';
import { decideCourseAuthoring } from '@/lib/access/authoring';
import { issueLessonMedia } from '@/lib/access/media';
import { requireViewer } from '@/lib/auth/guards';
import { sinceWhen } from '@/lib/format';
import { LessonEditor } from './lesson-editor';

/**
 * Editing one lesson (mockup 6, variant A): its title, its notes, its
 * recording, its handouts, and whether anybody may hear it.
 *
 * The authoring check runs against the lesson's course, which is where the
 * assignment lives. Reading the lesson first and then deciding would be the
 * wrong order only if the read leaked something, and it does not: the lookup
 * is tenant scoped, so a lesson at another institute is already invisible.
 *
 * THE PLAYABLE URL COMES FROM THE SAME PLACE A STUDENT'S DOES. issueLessonMedia
 * runs the access predicate rather than trusting that this page already
 * decided; staff pass it because the predicate says an admin sees everything
 * of their institute's and an instructor everything of the courses they are
 * assigned to. Signing a URL here on the strength of "well, they got this far"
 * would be a second, weaker rule for the same question.
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
    // findLessonWithCourse does not filter on publish state, so a draft is
    // found here exactly as a published lesson is; decideCourseAuthoring
    // below is what actually gates this page.
    const lesson = await findLessonWithCourse(scope, lessonId);
    if (!lesson) return null;

    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      lesson.courseId,
    );
    if (!decision.allowed) return null;

    const [section] = await scope.tx
      .select({ title: modules.title })
      .from(modules)
      .where(
        and(
          eq(modules.tenantId, scope.tenantId),
          eq(modules.id, lesson.moduleId),
        ),
      )
      .limit(1);

    return {
      lesson,
      sectionTitle: section?.title ?? null,
      resources: await listResourcesForLessons(scope, [lessonId]),
    };
  });

  if (!data) notFound();

  const media = await issueLessonMedia(
    { tenantId: viewer.tenant.id, userId: viewer.userId },
    lessonId,
  );
  const playable = (media ?? []).find((item) => item.kind === 'audio') ?? null;

  const now = new Date();
  const recording =
    data.resources.find((resource) => resource.kind === 'audio') ?? null;

  return (
    <div className="flex max-w-[900px] flex-col gap-[26px]">
      <Link
        href={`/teach/courses/${data.lesson.courseId}`}
        className="text-muted-foreground w-fit text-(length:--text-label) font-medium underline-offset-4 hover:underline"
      >
        {data.lesson.courseTitle}
        {/* The section only appears when a course has named one. A course
            with the single section nobody chose reads as just the course. */}
        {data.sectionTitle && data.sectionTitle !== 'Lessons'
          ? ` · ${data.sectionTitle}`
          : ''}
      </Link>

      <LessonEditor
        lesson={{
          id: data.lesson.id,
          title: data.lesson.title,
          contentMd: data.lesson.contentMd,
          isFreePreview: data.lesson.isFreePreview,
          durationSeconds: data.lesson.durationSeconds,
          courseTitle: data.lesson.courseTitle,
        }}
        recording={
          recording
            ? {
                id: recording.id,
                filename: recording.filename,
                byteSize: recording.byteSize,
                uploaded: sinceWhen(recording.createdAt, now),
              }
            : null
        }
        // Null whenever the object is not actually playable: an upload that
        // was reserved and never confirmed has a row and no bytes, and a play
        // button over nothing is worse than no play button.
        track={
          playable
            ? {
                lessonId: data.lesson.id,
                resourceId: playable.resourceId,
                title: data.lesson.title,
                courseTitle: data.lesson.courseTitle,
                href: `/lessons/${data.lesson.id}`,
                kind: 'audio' as const,
                url: playable.url,
                filename: playable.filename,
                isDownloadable: playable.isDownloadable,
              }
            : null
        }
        materials={data.resources
          .filter((resource) => resource.kind !== 'audio')
          .map((resource) => ({
            id: resource.id,
            kind: resource.kind,
            label: resource.filename ?? 'Material',
            byteSize: resource.byteSize,
            url: null,
          }))}
      />
    </div>
  );
}
