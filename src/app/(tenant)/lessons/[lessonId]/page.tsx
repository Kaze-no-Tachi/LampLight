import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import {
  findLessonWithCourse,
  listLessonsForCourse,
} from '@/db/repositories/lessons';
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
 * The sidebar lists the rest of the course, and asks the predicate about each
 * of those too rather than inferring them from this one's answer. A free
 * preview grants exactly one lesson, so "I am allowed in here" says nothing
 * about the lesson underneath it.
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

  const view = await getTenantDb(tenant.id).run(async (scope) => {
    const decision = await decideLessonAccess(scope, ctx, lessonId);
    if (!decision.allowed) return null;
    // The predicate already decided whether a draft was appropriate to grant
    // (admin and instructor, not an ordinary entitlement or free preview);
    // findLessonWithCourse itself does not filter on publish state, so this
    // second lookup returns the same row regardless of which branch granted.
    const lesson = await findLessonWithCourse(scope, lessonId);
    if (!lesson) return null;

    const siblings = await listLessonsForCourse(scope, lesson.courseId);
    const rows = [];
    for (const sibling of siblings) {
      const verdict = await decideLessonAccess(scope, ctx, sibling.id);
      rows.push({
        id: sibling.id,
        title: sibling.title,
        durationSeconds: sibling.durationSeconds,
        open: verdict.allowed,
      });
    }

    return { lesson, siblings: rows };
  });

  // Refused and nonexistent are the same 404, so a student cannot map the
  // catalog by watching which lesson ids render.
  if (!view) notFound();
  const { lesson, siblings } = view;

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

  const index = siblings.findIndex((row) => row.id === lesson.id);
  const position =
    index >= 0 ? `Lesson ${index + 1} of ${siblings.length}` : null;

  return (
    <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 px-8 pt-12 pb-24 lg:flex-row lg:items-start lg:gap-14">
      <div className="flex min-w-0 flex-1 flex-col gap-7">
        <header className="flex flex-col gap-3">
          {/* Back to the course rather than the shelf: this link also reaches a
              free-preview listener with no shelf to go back to. */}
          <Link
            href={`/catalogue/${lesson.courseSlug}`}
            className="text-muted-foreground w-fit text-(length:--text-label) underline-offset-4 hover:underline"
          >
            All lessons in this course
          </Link>

          <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
            {[position, lesson.courseTitle].filter(Boolean).join(' · ')}
          </span>

          <h1 className="text-[2.125rem] leading-[1.15] tracking-[-0.01em]">
            {lesson.title}
          </h1>

          {lesson.isFreePreview && (
            <span className="text-muted-foreground text-(length:--text-label)">
              Free preview, open to everyone.
            </span>
          )}
        </header>

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
          <p className="text-muted-foreground border-border bg-card rounded-(--radius) border px-7 py-6 text-(length:--text-ui)">
            No audio has been uploaded for this lesson yet.
          </p>
        )}

        {lesson.contentMd && (
          <section className="font-serif text-(length:--text-body) leading-[1.75]">
            <Markdown source={lesson.contentMd} />
          </section>
        )}
      </div>

      <aside className="flex w-full flex-col gap-6 lg:sticky lg:top-[88px] lg:w-[300px] lg:shrink-0">
        {documents.length > 0 && (
          <section className="border-border bg-card flex flex-col gap-2.5 rounded-(--radius) border px-6 py-5">
            <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
              Materials
            </span>
            <ul className="flex flex-col gap-1.5">
              {documents.map((item) => (
                <li key={item.resourceId} className="text-(length:--text-label)">
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

        <section className="border-border bg-card flex flex-col gap-2.5 rounded-(--radius) border px-6 py-5">
          <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
            In this course
          </span>
          <ol className="flex flex-col">
            {siblings.map((row, order) => (
              <SidebarLesson
                key={row.id}
                row={row}
                number={order + 1}
                current={row.id === lesson.id}
              />
            ))}
          </ol>
        </section>
      </aside>
    </main>
  );
}

/**
 * One row of the course list beside the player.
 *
 * Three weights, which is the whole point of the list: the lesson being heard
 * is at full strength, the ones that can be opened are slightly back, and the
 * locked ones are visible but clearly not available. A locked lesson still
 * shows its title and shows no duration, the same rule the catalogue follows.
 */
function SidebarLesson({
  row,
  number,
  current,
}: {
  row: {
    id: string;
    title: string;
    durationSeconds: number | null;
    open: boolean;
  };
  number: number;
  current: boolean;
}) {
  const label = (
    <>
      <span className="w-5 shrink-0 font-mono text-(length:--text-meta)">
        {String(number).padStart(2, '0')}
      </span>
      <span className="min-w-0 flex-1 leading-snug">{row.title}</span>
      <span className="shrink-0 font-mono text-(length:--text-meta)">
        {row.open && row.durationSeconds
          ? formatTime(row.durationSeconds)
          : row.open
            ? ''
            : 'Locked'}
      </span>
    </>
  );

  const shape = 'flex items-baseline gap-2.5 py-2 text-(length:--text-label)';

  if (current) {
    return (
      <li aria-current="true" className={`${shape} font-medium`}>
        {label}
      </li>
    );
  }

  if (!row.open) {
    return <li className={`${shape} opacity-45`}>{label}</li>;
  }

  return (
    <li className="opacity-80 hover:opacity-100">
      <Link href={`/lessons/${row.id}`} className={shape}>
        {label}
      </Link>
    </li>
  );
}
