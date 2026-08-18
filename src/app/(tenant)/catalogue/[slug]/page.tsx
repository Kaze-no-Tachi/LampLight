import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Panel, Tag } from 'rsuite';
import { getTenantDb } from '@/db/client';
import {
  findCourseBySlug,
  listCourseInstructors,
  listCourseStats,
  listProgramsForCourse,
  listTagsForCourses,
} from '@/db/repositories/catalog';
import { listLessonsForCourse } from '@/db/repositories/lessons';
import { can } from '@/lib/access/can';
import { issueCourseDocuments } from '@/lib/access/media';
import { decideLessonAccess } from '@/lib/access/predicate';
import { getSessionUser, getViewer } from '@/lib/auth/guards';
import { courseMeta, excerpt, money } from '@/lib/format';
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

    return {
      course,
      lessons: rows,
      enrollVerdict,
      tags: await listTagsForCourses(scope, [course.id]),
      instructors: await listCourseInstructors(scope, course.id),
      programs: await listProgramsForCourse(scope, course.id),
      stats: await listCourseStats(scope, [course.id]),
    };
  });

  // A course that is not published, or belongs to another institute, is not
  // found. Same answer either way.
  if (!view) notFound();

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

  const stat = view.stats[0];
  const taughtBy = view.instructors
    .map((person) => person.name ?? person.email)
    .join(', ');
  const meta = [
    taughtBy ? `Taught by ${taughtBy}` : null,
    courseMeta(stat?.lessonCount ?? 0, stat?.durationSeconds ?? null),
  ]
    .filter(Boolean)
    .join(' · ');

  // The blurb under the title and the notes further down come from the same
  // field, so the notes only earn a section of their own when the blurb did
  // not already say all of it. Otherwise a short description renders twice on
  // the same screen.
  const blurb = excerpt(view.course.descriptionMd, 240);
  const fullText = excerpt(view.course.descriptionMd, Number.MAX_SAFE_INTEGER);
  const hasLongerNotes = fullText.length > blurb.length;

  const access = accessNoteFor({
    enrolled,
    isStandalonePurchasable: view.course.isStandalonePurchasable,
    priceCents: view.course.priceCents,
    currency: view.course.currency,
    programTitle: view.programs[0]?.title ?? null,
  });

  return (
    <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 px-8 pt-12 pb-24 lg:flex-row lg:items-start lg:gap-14">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <header className="flex flex-col gap-3.5">
          <Link
            href="/catalogue"
            className="text-muted-foreground w-fit text-(length:--text-label) underline-offset-4 hover:underline"
          >
            All courses
          </Link>

          {view.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {view.tags.map((tag) => (
                <Tag key={tag.id} size="sm">
                  {tag.label}
                </Tag>
              ))}
            </div>
          ) : null}

          <h1 className="text-(length:--text-page) leading-[1.15] tracking-[-0.01em]">
            {view.course.title}
          </h1>

          {blurb ? (
            <p className="text-muted-foreground max-w-[62ch] text-(length:--text-body) leading-[1.6]">
              {blurb}
            </p>
          ) : null}

          <span className="text-muted-foreground text-(length:--text-label)">
            {meta}
          </span>
        </header>

        <section className="flex flex-col gap-3">
          <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
            Lessons
          </span>
          <LessonList mode="student" lessons={view.lessons} />
        </section>

        {view.course.descriptionMd && hasLongerNotes ? (
          <section className="flex flex-col gap-3">
            <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
              About this course
            </span>
            <div className="text-(length:--text-body) leading-[1.75]">
              <Markdown source={view.course.descriptionMd} />
            </div>
          </section>
        ) : null}
      </div>

      <aside className="w-full lg:sticky lg:top-[88px] lg:w-[320px] lg:shrink-0">
        <Panel bordered className="bg-card">
          <div className="flex flex-col gap-4">
            <span className="font-serif text-[2rem] leading-none">
              {access.priceLabel}
            </span>
            <p className="text-muted-foreground text-(length:--text-label) leading-[1.55]">
              {access.note}
            </p>

            {enrollState && (
              <EnrollButton
                slug={slug}
                courseId={view.course.id}
                state={enrollState}
              />
            )}

            {documents.length > 0 && (
              <div className="border-border flex flex-col gap-2 border-t pt-4">
                <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
                  Included
                </span>
                <ul className="flex flex-col gap-1.5">
                  {documents.map((doc) => (
                    <li
                      key={doc.resourceId}
                      className="text-(length:--text-label)"
                    >
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-4"
                      >
                        {doc.title}
                      </a>
                      {!doc.isPublic && (
                        <span className="text-muted-foreground ml-2 text-[0.71875rem]">
                          enrolled students only
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {view.programs.length > 0 && (
              <div className="border-border flex flex-col gap-2 border-t pt-4">
                <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
                  Part of
                </span>
                {view.programs.map((program) => (
                  <div key={program.id} className="flex flex-col gap-0.5">
                    <span className="text-(length:--text-ui) font-medium">
                      {program.title}
                    </span>
                    <span className="text-muted-foreground text-(length:--text-label)">
                      {money(program.priceCents)} for the whole program
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </aside>
    </main>
  );
}

/**
 * What the sidebar says about the price of this course.
 *
 * Reads from the same facts the catalogue's state tag uses, in the same order,
 * so the two surfaces cannot disagree about whether somebody is enrolled.
 *
 * Enrolling ignores price (round 2 decision, see catalogue/actions.ts), so
 * these read as what the course is worth rather than as a paywall.
 */
function accessNoteFor({
  enrolled,
  isStandalonePurchasable,
  priceCents,
  currency,
  programTitle,
}: {
  enrolled: boolean;
  isStandalonePurchasable: boolean;
  priceCents: number;
  currency: string;
  programTitle: string | null;
}): { priceLabel: string; note: string } {
  if (enrolled) {
    return {
      priceLabel: 'Included',
      note: 'You are enrolled. Every lesson below is open to you.',
    };
  }
  if (priceCents === 0) {
    return {
      priceLabel: 'Free',
      note: 'Free to everyone at this institute.',
    };
  }
  if (!isStandalonePurchasable) {
    return {
      priceLabel: programTitle ? 'In the program' : 'Not offered separately',
      note: programTitle
        ? `Part of ${programTitle} rather than a course on its own.`
        : 'Part of a program rather than a course on its own.',
    };
  }
  return {
    priceLabel: money(priceCents, currency),
    note: 'One enrolment, kept for good.',
  };
}

