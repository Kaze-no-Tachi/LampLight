import Link from 'next/link';
import { Panel } from 'rsuite';
import { getTenantDb } from '@/db/client';
import { findMembershipDetail } from '@/db/repositories/entitlements';
import { listProgramProgress, listShelfCourses } from '@/db/repositories/shelf';
import { requireViewer } from '@/lib/auth/guards';
import { firstName, greeting, runningTime, timeLeft } from '@/lib/format';

/**
 * The student's own shelf: what they are on, and where they are in it.
 *
 * Separate from the catalogue at /catalogue, which answers "what does this
 * institute offer" for anybody, member or not. This answers "what am I part
 * way through", which needs an entitlement and is nobody else's business, so
 * it is gated like every other personal page: requireViewer, the same 404 for
 * a stranger and for somebody signed in at a different institute.
 *
 * NOTHING ON THIS PAGE IS A DEADLINE
 *
 * No dates, no streaks, no "due" badges, no count of days missed. Courses here
 * are self-paced and mostly studied by people with jobs, and a shelf that
 * keeps score turns a fortnight away from study into a reason not to come
 * back. The design says so explicitly and it is the reason the greeting reads
 * "nothing is due" rather than showing how long it has been.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Your study' };

export default async function ShelfPage() {
  const viewer = await requireViewer();

  const { courses, programs, membership } = await getTenantDb(
    viewer.tenant.id,
  ).run(async (scope) => ({
    courses: await listShelfCourses(scope, viewer.userId),
    programs: await listProgramProgress(scope, viewer.userId),
    membership: await findMembershipDetail(scope, viewer.userId),
  }));

  // The one lesson this page is really for: the first course with somewhere to
  // go. Ordered by the shelf itself rather than by recency, because "what am I
  // in the middle of" and "what did I touch last" are the same thing here.
  const resume = courses.find((course) => course.next);

  return (
    <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-12 px-8 pt-14 pb-24">
      <header className="flex flex-col gap-2.5">
        <h1 className="text-(length:--text-hero) leading-[1.15] tracking-[-0.01em]">
          {greeting(new Date())},{' '}
          {firstName(membership?.name ?? null, viewer.email)}.
        </h1>
        <p className="text-muted-foreground max-w-[60ch] text-(length:--text-body) leading-[1.65]">
          {resume
            ? 'Nothing is due. Pick up whichever lesson you have room for tonight.'
            : 'Nothing is due, and nothing is waiting. Start something whenever you are ready.'}
        </p>
      </header>

      {resume?.next ? (
        <ResumeCard
          courseTitle={resume.title}
          lessonId={resume.next.id}
          lessonTitle={resume.next.title}
          positionSeconds={resume.next.positionSeconds}
          durationSeconds={resume.next.durationSeconds}
        />
      ) : null}

      {courses.length === 0 ? (
        <p className="text-muted-foreground text-(length:--text-ui)">
          Nothing here yet.{' '}
          <Link href="/catalogue" className="underline underline-offset-4">
            Browse the catalogue
          </Link>{' '}
          and enrol in something, or ask the office to enrol you.
        </p>
      ) : (
        <section className="flex flex-col gap-[18px]">
          <div className="border-border flex flex-wrap items-baseline justify-between gap-4 border-b pb-3">
            <h2 className="text-(length:--text-section) leading-tight">
              Your courses
            </h2>
            <Link
              href="/catalogue"
              className="text-muted-foreground text-(length:--text-label) underline-offset-4 hover:underline"
            >
              Browse the catalogue
            </Link>
          </div>

          <Panel bordered bodyFill className="bg-card overflow-hidden">
            {courses.map((course) => (
              <CourseRow key={course.courseId} course={course} />
            ))}
          </Panel>
        </section>
      )}

      {programs.length > 0 ? (
        <section className="flex flex-col gap-[18px]">
          <div className="border-border flex flex-wrap items-baseline justify-between gap-4 border-b pb-3">
            <h2 className="text-(length:--text-section) leading-tight">
              Your programs
            </h2>
          </div>

          {programs.map((program) => (
            <Panel key={program.programId} bordered className="bg-card">
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-(length:--text-card-title) leading-tight">
                    {program.title}
                  </h3>
                  <span className="font-mono text-(length:--text-label)">
                    {program.percent}%
                  </span>
                </div>

                <ProgressBar percent={program.percent} />

                <ul className="flex flex-col gap-1.5 pt-1">
                  {program.courses.map((course) => (
                    <li
                      key={course.courseId}
                      className="flex items-center justify-between gap-3 text-(length:--text-label)"
                    >
                      <Link
                        href={`/catalogue/${course.slug}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {course.title}
                      </Link>
                      <span className="text-muted-foreground font-mono">
                        {course.completedCount} of {course.lessonCount}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          ))}
        </section>
      ) : null}
    </main>
  );
}

/**
 * The one wide card at the top: the lesson to press play on.
 *
 * A course row could carry this and the design deliberately does not let it.
 * A returning student has one question, and answering it with a list means
 * they read every row to find the one they were already on.
 */
function ResumeCard({
  courseTitle,
  lessonId,
  lessonTitle,
  positionSeconds,
  durationSeconds,
}: {
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  positionSeconds: number;
  durationSeconds: number | null;
}) {
  const started = positionSeconds > 0;
  // "41 min left of 41" is a strange way to describe a lesson nobody has
  // opened, so an unstarted one just states how long it is.
  const remaining = started
    ? timeLeft(positionSeconds, durationSeconds)
    : runningTime(durationSeconds);
  const percent =
    durationSeconds && durationSeconds > 0
      ? Math.min(100, Math.round((positionSeconds / durationSeconds) * 100))
      : 0;

  return (
    <Panel bordered className="bg-card">
      <div className="flex flex-wrap items-center gap-6">
        {/* The play button is the link. A student reaching for it is reaching
            for the lesson, not for a control that then reveals one. */}
        <Link
          href={`/lessons/${lessonId}`}
          aria-label={`${started ? 'Continue' : 'Start'} ${lessonTitle}`}
          className="bg-primary text-primary-foreground flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-muted-foreground text-(length:--text-meta) font-semibold tracking-[0.14em] uppercase">
            {started ? 'Pick up where you stopped' : 'Start when you are ready'}
          </span>

          <Link
            href={`/lessons/${lessonId}`}
            className="font-serif text-[1.5625rem] leading-snug underline-offset-4 hover:underline"
          >
            {lessonTitle}
          </Link>

          <span className="text-muted-foreground text-(length:--text-label)">
            {[courseTitle, remaining].filter(Boolean).join(' · ')}
          </span>

          {started ? (
            <div className="max-w-[420px] pt-1">
              <ProgressBar percent={percent} thick />
            </div>
          ) : null}
        </div>

        <Link
          href={`/lessons/${lessonId}`}
          className="bg-primary text-primary-foreground shrink-0 rounded-(--radius) px-[1.125rem] py-[0.6875rem] text-(length:--text-ui) font-medium"
        >
          {started ? 'Continue' : 'Start'}
        </Link>
      </div>
    </Panel>
  );
}

function CourseRow({
  course,
}: {
  course: {
    courseId: string;
    title: string;
    slug: string;
    via: 'course' | 'program';
    sourceTitle: string;
    lessonCount: number;
    completedCount: number;
    next: { id: string; positionSeconds: number } | null;
  };
}) {
  const percent =
    course.lessonCount === 0
      ? 0
      : Math.round((course.completedCount / course.lessonCount) * 100);

  return (
    <div className="border-border hover:bg-muted flex flex-wrap items-center gap-5 px-6 py-5 transition-colors not-first:border-t">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/catalogue/${course.slug}`}
          className="font-serif text-(length:--text-row-title) leading-snug underline-offset-4 hover:underline"
        >
          {course.title}
        </Link>
        <span className="text-muted-foreground text-(length:--text-label)">
          {course.lessonCount === 0
            ? 'No lessons published yet'
            : `${course.completedCount} of ${course.lessonCount} lessons`}
          {course.via === 'program' ? ` · via ${course.sourceTitle}` : ''}
        </span>
      </div>

      {course.lessonCount > 0 ? (
        <div className="flex w-[120px] shrink-0 items-center gap-3">
          <ProgressBar percent={percent} />
        </div>
      ) : null}

      <span className="text-muted-foreground w-10 shrink-0 text-right font-mono text-(length:--text-label)">
        {course.lessonCount > 0 ? `${percent}%` : ''}
      </span>

      {course.next ? (
        <Link
          href={`/lessons/${course.next.id}`}
          className="bg-secondary text-secondary-foreground shrink-0 rounded-(--radius) px-3.5 py-2 text-(length:--text-ui) font-medium"
        >
          {course.next.positionSeconds > 0 ? 'Continue' : 'Start'}
        </Link>
      ) : course.lessonCount > 0 ? (
        <span className="text-muted-foreground shrink-0 text-(length:--text-label)">
          Finished
        </span>
      ) : null}
    </div>
  );
}

function ProgressBar({
  percent,
  thick = false,
}: {
  percent: number;
  thick?: boolean;
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`bg-muted w-full overflow-hidden rounded-full ${
        thick ? 'h-[5px]' : 'h-1.5'
      }`}
    >
      <div
        className="bg-primary h-full rounded-full"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
