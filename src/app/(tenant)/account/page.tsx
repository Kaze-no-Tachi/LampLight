import Link from 'next/link';
import { getTenantDb } from '@/db/client';
import {
  findMembershipDetail,
  listEnrolledCourses,
  type EnrolledCourse,
} from '@/db/repositories/entitlements';
import { findSignupQuestions } from '@/db/repositories/settings';
import { requireViewer } from '@/lib/auth/guards';
import { parseQuestions } from '@/lib/signup/questions';
import { ChangeNameForm, ChangePasswordForm } from './profile-forms';

/**
 * A person's own record at this institute.
 *
 * A gated page, and the smallest honest demonstration of the isolation model.
 * requireViewer needs both halves: a session, and a membership in the tenant
 * resolved from the Host header. Someone signed in at one institute who visits
 * another institute's domain has the first and not the second, and gets the
 * ordinary 404, identical to the one an unknown visitor sees.
 *
 * Everything shown here is read under this institute's scope, including the
 * intake answers, which live on the membership rather than on the global user.
 * A person who studies at two institutes has two of these pages and they do
 * not know about each other.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Your account' };

export default async function AccountPage() {
  const viewer = await requireViewer();

  const { membership, courses, questions } = await getTenantDb(
    viewer.tenant.id,
  ).run(async (scope) => ({
    membership: await findMembershipDetail(scope, viewer.userId),
    courses: await listEnrolledCourses(scope, viewer.userId),
    questions: parseQuestions(await findSignupQuestions(scope)),
  }));

  const answers = readAnswers(membership?.profileJson);
  const answered = questions.filter((question) => answers[question.id]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {viewer.email}
        </h1>
        <p className="text-muted-foreground">
          {describeRole(viewer.role)}
          {membership ? ` Joined ${formatDate(membership.joinedAt)}.` : ''}
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Your courses</h2>

        {courses.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing yet.{' '}
            <Link href="/catalogue" className="underline underline-offset-4">
              Have a look at the catalogue
            </Link>
            , or ask the office to enrol you.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {courses.map((course) => (
              <li
                key={course.courseId}
                className="bg-card border-border rounded-(--radius) border p-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link
                    href={`/catalogue/${course.slug}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {course.title}
                  </Link>
                  {expired(course) && (
                    <span className="text-muted-foreground border-border rounded-full border px-2 py-0.5 text-xs">
                      Access ended
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {describeSource(course)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Your details</h2>
          <p className="text-muted-foreground text-sm">
            Your name is what other people here see. Your address is how you
            sign in, and changing it is not self-serve: ask the office.
          </p>
        </div>
        <ChangeNameForm name={membership?.name ?? ''} />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Password</h2>
          <p className="text-muted-foreground text-sm">
            Changing it signs out anything else that is signed in as you.
          </p>
        </div>
        <ChangePasswordForm />
      </section>

      {answered.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight">
              What you told {viewer.tenant.name}
            </h2>
            <p className="text-muted-foreground text-sm">
              Your answers to this institute&rsquo;s own questions. They are
              kept here and nowhere else on Lamplight.
            </p>
          </div>

          <dl className="flex flex-col gap-3">
            {answered.map((question) => (
              <div
                key={question.id}
                className="border-border flex flex-col gap-1 border-l-2 pl-4"
              >
                <dt className="text-muted-foreground text-sm">
                  {question.label}
                </dt>
                <dd>{answers[question.id]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </main>
  );
}

/**
 * Reads profile_json into displayable strings.
 *
 * Values are shown as React children, so they are escaped. What this guards
 * against is not markup but shape: the column is jsonb and nothing stops an
 * older row from holding a nested object, which would otherwise render as
 * "[object Object]" on somebody's profile.
 */
function readAnswers(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim()) answers[key] = value;
    if (typeof value === 'boolean') answers[key] = value ? 'Yes' : 'No';
  }
  return answers;
}

function expired(course: EnrolledCourse): boolean {
  return course.expiresAt !== null && course.expiresAt.getTime() < Date.now();
}

/** Says where a course came from, in the words somebody would use for it. */
function describeSource(course: EnrolledCourse): string {
  const arrival =
    course.via === 'program'
      ? `Part of ${course.sourceTitle}`
      : course.granted
        ? 'Enrolled by the office'
        : 'Bought on its own';

  if (course.expiresAt === null) return `${arrival}. No end date.`;
  return expired(course)
    ? `${arrival}. Access ended ${formatDate(course.expiresAt)}.`
    : `${arrival}. Access until ${formatDate(course.expiresAt)}.`;
}

function describeRole(role: 'student' | 'instructor' | 'admin'): string {
  if (role === 'admin') return 'You administer this institute.';
  if (role === 'instructor') return 'You teach here.';
  return 'You are enrolled here as a student.';
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
