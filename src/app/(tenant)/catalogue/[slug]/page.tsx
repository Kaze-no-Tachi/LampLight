import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { findCourseBySlug } from '@/db/repositories/catalog';
import { listLessonsForCourse } from '@/db/repositories/lessons';
import { can } from '@/lib/access/can';
import { issueCourseDocuments } from '@/lib/access/media';
import { decideLessonAccess } from '@/lib/access/predicate';
import { getSessionUser, getViewer } from '@/lib/auth/guards';
import { Markdown } from '@/lib/markdown/render';
import { requireTenant } from '@/lib/tenancy/context';
import { LessonList } from '../../lesson-list';
import { EnrollButton } from './enroll-button';

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
  // Separate from `user`: a session can exist with no standing at this
  // institute (signed in at one institute, visiting another's domain), and
  // enrolling requires a membership here, not merely an account somewhere on
  // the platform.
  const viewer = await getViewer();

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

    const enrollVerdict = viewer
      ? await can(
          scope,
          {
            tenantId: viewer.tenant.id,
            userId: viewer.userId,
            role: viewer.role,
          },
          'course:enroll',
          { kind: 'course', id: course.id },
        )
      : null;

    return { course, lessons: rows, enrollVerdict };
  });

  // A course that is not published, or belongs to another institute, is not
  // found. Same answer either way.
  if (!view) notFound();

  const openCount = view.lessons.filter((lesson) => lesson.open).length;

  // A document is shown when it is public, or when this viewer has been let
  // into at least one gated lesson, which is the cheapest honest proxy for
  // "is enrolled" without asking the predicate a second question it was not
  // designed to answer. A syllabus is public; a handout usually is not.
  const enrolled = view.lessons.some(
    (lesson) => lesson.open && !lesson.isFreePreview,
  );
  // Signed where the document is an upload of ours, passed through where the
  // institute pointed at their own site, and skipped where the upload was
  // never confirmed to have arrived.
  const documents = await issueCourseDocuments(
    { tenantId: tenant.id, userId: user?.id ?? null },
    view.course.id,
    { enrolled },
  );

  const enrollState = !viewer
    ? ('signed-out' as const)
    : view.enrollVerdict?.allowed
      ? ('can-enroll' as const)
      : view.enrollVerdict?.reason === 'already-enrolled'
        ? ('already-enrolled' as const)
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/catalogue"
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

      {enrollState && (
        <EnrollButton
          slug={slug}
          courseId={view.course.id}
          state={enrollState}
        />
      )}

      {view.course.descriptionMd && (
        <section className="text-muted-foreground flex flex-col gap-3">
          <Markdown source={view.course.descriptionMd} />
        </section>
      )}

      {documents.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Course documents</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {documents.map((doc) => (
              <li key={doc.resourceId}>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {doc.title}
                </a>
                {!doc.isPublic && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    enrolled students only
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <LessonList mode="student" lessons={view.lessons} />
    </main>
  );
}
