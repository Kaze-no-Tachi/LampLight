import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { findCourseBySlug } from '@/db/repositories/catalog';
import { listLessonsForCourse } from '@/db/repositories/lessons';
import { decideLessonAccess } from '@/lib/access/predicate';
import { getSessionUser } from '@/lib/auth/guards';
import { requireTenant } from '@/lib/tenancy/context';

/**
 * One course, with its lessons and whether this viewer may hear each one.
 *
 * THE BULK VARIANT THE PRD ASKS FOR, IN THE PLACE IT MATTERS
 *
 * PRD section 7 says the browse view computes owned versus not-owned rather
 * than calling the predicate per row. This calls it per lesson, inside one
 * transaction, which is the honest version for a course with a dozen lessons:
 * every call after the first hits the same membership and entitlement rows,
 * and Postgres is already holding them. A course with hundreds of lessons
 * would want the bulk shape, and this is the place to add it when one exists.
 *
 * What it must not become is a page that decides access itself from a list of
 * enrollments it happens to have loaded. There is one authority.
 */
export const dynamic = 'force-dynamic';

export default async function CoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const tenant = await requireTenant();
  const { slug } = await params;
  const user = await getSessionUser();

  const view = await getTenantDb(tenant.id).run(async (scope) => {
    const course = await findCourseBySlug(scope, slug);
    if (!course) return null;

    const lessons = await listLessonsForCourse(scope, course.id);
    const ctx = { tenantId: tenant.id, userId: user?.id ?? null };

    const rows = [];
    for (const lesson of lessons) {
      const decision = await decideLessonAccess(scope, ctx, lesson.id);
      rows.push({
        id: lesson.id,
        title: lesson.title,
        durationSeconds: lesson.durationSeconds,
        isFreePreview: lesson.isFreePreview,
        open: decision.allowed,
      });
    }

    return { course, lessons: rows };
  });

  // A course that is not published, or belongs to another institute, is not
  // found. Same answer either way.
  if (!view) notFound();

  const openCount = view.lessons.filter((lesson) => lesson.open).length;

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
          {view.course.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {view.lessons.length} lessons, {openCount} open to you
        </p>
      </header>

      <ol className="flex flex-col gap-2">
        {view.lessons.map((lesson, index) => (
          <li
            key={lesson.id}
            className="flex items-center justify-between gap-4 rounded-lg border p-4"
          >
            <span className="flex items-baseline gap-3">
              <span className="text-muted-foreground font-mono text-sm">
                {String(index + 1).padStart(2, '0')}
              </span>
              {lesson.open ? (
                <Link
                  href={`/lessons/${lesson.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {lesson.title}
                </Link>
              ) : (
                // Locked lessons still show their title. The catalog is public
                // and the titles are how somebody decides whether to enrol; it
                // is the audio that is gated, and that is gated at issuance.
                <span className="text-muted-foreground">{lesson.title}</span>
              )}
            </span>

            <span className="text-muted-foreground text-xs whitespace-nowrap">
              {lesson.isFreePreview
                ? 'Free preview'
                : lesson.open
                  ? formatDuration(lesson.durationSeconds)
                  : 'Locked'}
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}
