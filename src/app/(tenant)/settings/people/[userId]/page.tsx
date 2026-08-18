import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { findSignupQuestions } from '@/db/repositories/settings';
import {
  findMembershipDetail,
  listRoster,
} from '@/db/repositories/entitlements';
import { requireRole } from '@/lib/auth/guards';
import { parseQuestions } from '@/lib/signup/questions';

/**
 * One person, in the detail a 320px panel has no room for.
 *
 * Access itself moved to /settings/people, where the roster is (mockup 10):
 * granting is the reason an admin opens People, and doing it beside the list
 * means enrolling four people off one cheque is four clicks rather than four
 * navigations. What is left here is what somebody told the institute when they
 * signed up, which is read once and is nobody's daily work.
 *
 * A membership that does not exist here is a 404, the same one an unknown path
 * gets. An admin looking up a user id from another institute must not be able
 * to tell that the id is real somewhere else.
 */
export const dynamic = 'force-dynamic';

export default async function PersonPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const viewer = await requireRole('admin');
  const { userId } = await params;

  const data = await getTenantDb(viewer.tenant.id).run(async (scope) => ({
    membership: await findMembershipDetail(scope, userId),
    // The roster read is what puts a name and an address on the id. There is
    // no repository call that fetches a global user by id, on purpose: the
    // only way to see a person here is through this institute's own
    // membership rows.
    roster: await listRoster(scope),
    questions: parseQuestions(await findSignupQuestions(scope)),
  }));

  if (!data.membership) notFound();

  const person = data.roster.find((entry) => entry.userId === userId);
  const answers = readAnswers(data.membership.profileJson);
  const answered = data.questions.filter((question) => answers[question.id]);

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <Link
        href={`/settings/people?person=${userId}`}
        className="text-muted-foreground w-fit text-(length:--text-label) font-medium underline-offset-4 hover:underline"
      >
        People
      </Link>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-(length:--text-staff-page) leading-[1.2]">
          {person?.name || person?.email || 'This person'}
        </h1>
        <p className="text-muted-foreground text-(length:--text-ui)">
          {person?.email}, {data.membership.role}, joined{' '}
          {formatDate(data.membership.joinedAt)}
        </p>
      </div>

      <section className="border-border bg-card flex flex-col gap-3.5 rounded-(--radius) border px-6 py-[22px]">
        <h2 className="text-(length:--text-row-title) leading-tight">
          What they told you at signup
        </h2>

        {answered.length === 0 ? (
          <p className="text-muted-foreground text-(length:--text-label)">
            Nothing. Either this institute asks no questions at signup, or this
            person joined before it did.
          </p>
        ) : (
          <dl className="flex flex-col gap-3">
            {answered.map((question) => (
              <div
                key={question.id}
                className="border-border flex flex-col gap-1 border-l-2 pl-4"
              >
                <dt className="text-muted-foreground text-(length:--text-label)">
                  {question.label}
                </dt>
                <dd className="text-(length:--text-ui)">
                  {answers[question.id]}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

/** Same shape guard as the student's own profile page: jsonb holds anything. */
function readAnswers(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim()) answers[key] = value;
    if (typeof value === 'boolean') answers[key] = value ? 'Yes' : 'No';
  }
  return answers;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
