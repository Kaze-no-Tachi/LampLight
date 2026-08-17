import Link from 'next/link';
import { getTenantDb } from '@/db/client';
import { listProgramProgress, listShelfCourses } from '@/db/repositories/shelf';
import { requireViewer } from '@/lib/auth/guards';

/**
 * The student's own shelf: what they are on, and where they are in it.
 *
 * Separate from the catalogue at /catalogue, which answers "what does this
 * institute offer" for anybody, member or not. This answers "what am I part
 * way through", which needs an entitlement and is nobody else's business, so
 * it is gated like every other personal page: requireViewer, the same 404 for
 * a stranger and for somebody signed in at a different institute.
 *
 * A course reached through a program still gets its own row here, alongside
 * the program's own summary further down: the individual lesson to continue
 * is what a returning student wants first, the program percentage is the
 * second question.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Your courses' };

export default async function ShelfPage() {
  const viewer = await requireViewer();

  const { courses, programs } = await getTenantDb(viewer.tenant.id).run(
    async (scope) => ({
      courses: await listShelfCourses(scope, viewer.userId),
      programs: await listProgramProgress(scope, viewer.userId),
    }),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Your courses</h1>
        <p className="text-muted-foreground">
          <Link href="/catalogue" className="underline underline-offset-4">
            Browse the catalogue
          </Link>{' '}
          to find something new.
        </p>
      </header>

      {courses.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing here yet.{' '}
          <Link href="/catalogue" className="underline underline-offset-4">
            Browse the catalogue
          </Link>{' '}
          and enrol in something, or ask the office to enrol you.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {courses.map((course) => (
            <li
              key={course.courseId}
              className="bg-card border-border flex flex-col gap-3 rounded-(--radius) border p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/catalogue/${course.slug}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {course.title}
                </Link>
                {course.via === 'program' && (
                  <span className="text-muted-foreground text-sm">
                    Via {course.sourceTitle}
                  </span>
                )}
              </div>

              {course.lessonCount > 0 && (
                <ProgressBar
                  completed={course.completedCount}
                  total={course.lessonCount}
                />
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-sm">
                  {course.lessonCount === 0
                    ? 'No lessons published yet'
                    : `${course.completedCount} of ${course.lessonCount} lessons`}
                </span>
                {course.next ? (
                  <Link
                    href={`/lessons/${course.next.id}`}
                    className="bg-primary text-primary-foreground rounded-(--radius) px-3 py-1.5 text-sm font-medium"
                  >
                    {course.next.positionSeconds > 0 ? 'Continue' : 'Start'}
                  </Link>
                ) : (
                  course.lessonCount > 0 && (
                    <span className="text-muted-foreground text-sm">
                      Completed
                    </span>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {programs.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold tracking-tight">Programs</h2>
          <ul className="flex flex-col gap-4">
            {programs.map((program) => (
              <li
                key={program.programId}
                className="bg-card border-border flex flex-col gap-3 rounded-(--radius) border p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{program.title}</span>
                  <span className="text-muted-foreground text-sm">
                    {program.percent}%
                  </span>
                </div>
                <ProgressBar completed={program.percent} total={100} />
                <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
                  {program.courses.map((course) => (
                    <li
                      key={course.courseId}
                      className="flex items-center justify-between gap-2"
                    >
                      <Link
                        href={`/catalogue/${course.slug}`}
                        className="hover:underline"
                      >
                        {course.title}
                      </Link>
                      <span>
                        {course.completedCount} of {course.lessonCount}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function ProgressBar({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="bg-muted h-2 w-full overflow-hidden rounded-full"
    >
      <div
        className="bg-primary h-full rounded-full"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
