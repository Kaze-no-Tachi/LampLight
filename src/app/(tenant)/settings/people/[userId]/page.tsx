import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import {
  findMembershipDetail,
  listEnrollmentDetails,
  listGrantableSources,
  listRoster,
} from '@/db/repositories/entitlements';
import { requireRole } from '@/lib/auth/guards';
import { parseQuestions } from '@/lib/signup/questions';
import { findSignupQuestions } from '@/db/repositories/settings';
import { AccessPanel } from './access-panel';

/**
 * One person's access at this institute (PRD requirement P0-11).
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
    enrollments: await listEnrollmentDetails(scope, userId),
    sources: await listGrantableSources(scope),
    // The roster read is what puts a name and an address on the id. There is no
    // repository call that fetches a global user by id, on purpose: the only way
    // to see a person here is through this institute's own membership rows.
    roster: await listRoster(scope),
    questions: parseQuestions(await findSignupQuestions(scope)),
  }));

  if (!data.membership) notFound();

  const person = data.roster.find((entry) => entry.userId === userId);
  const answers = readAnswers(data.membership.profileJson);
  const answered = data.questions.filter((question) => answers[question.id]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link
          href="/settings/people"
          className="text-muted-foreground text-sm hover:underline"
        >
          Back to people
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {person?.name || person?.email || 'This person'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {person?.email}, {data.membership.role}, joined{' '}
          {formatDate(data.membership.joinedAt)}
        </p>
      </div>

      <AccessPanel
        userId={userId}
        enrollments={data.enrollments.map((enrollment) => ({
          id: enrollment.id,
          sourceKind: enrollment.sourceKind,
          sourceTitle: enrollment.sourceTitle,
          expiresAt: enrollment.expiresAt?.toISOString() ?? null,
          granted: enrollment.grantedBy !== null,
        }))}
        sources={data.sources}
      />

      {answered.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">What they told you at signup</h2>
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
