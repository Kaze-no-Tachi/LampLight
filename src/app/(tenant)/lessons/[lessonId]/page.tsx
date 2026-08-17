import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { findLessonWithCourse } from '@/db/repositories/lessons';
import { issueLessonMedia } from '@/lib/access/media';
import { decideLessonAccess } from '@/lib/access/predicate';
import { getSessionUser } from '@/lib/auth/guards';
import { Markdown } from '@/lib/markdown/render';
import { formatTime } from '@/lib/player/track';
import { requireTenant } from '@/lib/tenancy/context';
import { LessonPlayButton } from './lesson-player';

/**
 * A lesson, with its audio if this viewer may have it.
 *
 * The page and the media issuance run the same predicate, and that is not
 * duplication worth removing: the page needs to know whether to render at all,
 * and issuance needs to decide independently, because it is reachable directly
 * over HTTP by anybody who guesses a lesson id. Two callers, one authority.
 *
 * Never prerendered and never cached. The URLs below are bearer tokens scoped
 * to one person's entitlement.
 */
export const dynamic = 'force-dynamic';

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const tenant = await requireTenant();
  const { lessonId } = await params;
  const user = await getSessionUser();
  const ctx = { tenantId: tenant.id, userId: user?.id ?? null };

  const lesson = await getTenantDb(tenant.id).run(async (scope) => {
    const decision = await decideLessonAccess(scope, ctx, lessonId);
    if (!decision.allowed) return null;
    return findLessonWithCourse(scope, lessonId);
  });

  // Refused and nonexistent are the same 404, so a student cannot map the
  // catalog by watching which lesson ids render.
  if (!lesson) notFound();

  const media = await issueLessonMedia(ctx, lessonId);
  const audio = (media ?? []).filter((item) => item.kind === 'audio');
  // Everything that is not audio is something to open rather than play. The
  // URLs are signed and short lived exactly as the audio ones are: a lesson
  // handout is as much a thing somebody paid for as the recording is.
  const documents = (media ?? []).filter((item) => item.kind !== 'audio');

  // One recording per lesson in practice. If a lesson ever carries several,
  // the first is the lecture and the rest are alternates, which is a queue and
  // a decision for the day somebody needs it.
  const first = audio[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/courses"
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        >
          {tenant.name}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          {lesson.title}
        </h1>
        {lesson.isFreePreview && (
          <p className="text-muted-foreground text-sm">
            Free preview, open to everyone.
          </p>
        )}
      </header>

      {lesson.contentMd && (
        <section className="text-muted-foreground flex flex-col gap-3">
          <Markdown source={lesson.contentMd} />
        </section>
      )}

      {documents.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Materials</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {documents.map((item) => (
              <li key={item.resourceId}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {item.filename ?? 'Document'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {first ? (
        <LessonPlayButton
          duration={
            lesson.durationSeconds ? formatTime(lesson.durationSeconds) : null
          }
          track={{
            lessonId: lesson.id,
            resourceId: first.resourceId,
            title: lesson.title,
            courseTitle: lesson.courseTitle,
            href: `/lessons/${lesson.id}`,
            kind: 'audio',
            url: first.url,
            filename: first.filename,
            isDownloadable: first.isDownloadable,
          }}
        />
      ) : (
        <p className="text-muted-foreground">
          No audio has been uploaded for this lesson yet.
        </p>
      )}
    </main>
  );
}
