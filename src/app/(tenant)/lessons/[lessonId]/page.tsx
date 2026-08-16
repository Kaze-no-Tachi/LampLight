import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { findLessonWithCourse } from '@/db/repositories/lessons';
import { issueLessonMedia } from '@/lib/access/media';
import { decideLessonAccess } from '@/lib/access/predicate';
import { getSessionUser } from '@/lib/auth/guards';
import { requireTenant } from '@/lib/tenancy/context';
import { LessonPlayer } from './lesson-player';

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

      {audio.length === 0 ? (
        <p className="text-muted-foreground">
          No audio has been uploaded for this lesson yet.
        </p>
      ) : (
        <LessonPlayer
          title={lesson.title}
          sources={audio.map((item) => ({
            id: item.resourceId,
            url: item.url,
            filename: item.filename,
            isDownloadable: item.isDownloadable,
          }))}
        />
      )}
    </main>
  );
}
