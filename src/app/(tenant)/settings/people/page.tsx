import Link from 'next/link';
import { getTenantDb } from '@/db/client';
import {
  listEnrollmentDetails,
  listGrantableSources,
  listRoster,
  listRosterAccess,
  type RosterAccess,
} from '@/db/repositories/entitlements';
import { requireRole } from '@/lib/auth/guards';
import { AccessPanel } from './access-panel';
import { InviteForm } from './invite-form';

/**
 * Who belongs to this institute, and what they can reach (mockup 10, and PRD
 * requirement P0-11).
 *
 * Admin only. An instructor can see the students in their own courses, which
 * is a different and narrower question, and it belongs on the course.
 *
 * WHY SELECTION IS A URL AND NOT COMPONENT STATE. The mockup selects a row and
 * fills the panel beside it, which reads as though everything is already in
 * the browser. Doing it that way would mean shipping every member's
 * entitlements to the page, and a roster is the one thing here that grows
 * without bound. The row is a link to the same screen with ?person=, the
 * server renders the panel for that person, and the roster itself never
 * crosses the wire as data. It also means an admin can send somebody the URL
 * of the person they are talking about.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'People' };

/**
 * What the Access column says: the entitlements this person holds, named,
 * with anything expired counted separately.
 *
 * Names rather than a count, because "Certificate in Biblical Studies" answers
 * the question an admin scanning this column is asking and "3" does not. Past
 * two, it stops listing: a column is not a place to read a list.
 */
function accessLine(held: RosterAccess[], now: Date): string {
  const live = held.filter(
    (row) => row.expiresAt === null || row.expiresAt.getTime() > now.getTime(),
  );

  if (held.length === 0) return 'Nothing yet';
  if (live.length === 0) return 'Expired';
  if (live.length === 1) return live[0]?.sourceTitle ?? 'One thing';
  if (live.length === 2) {
    return `${live[0]?.sourceTitle} and one more`;
  }
  return `${live[0]?.sourceTitle} and ${live.length - 1} more`;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const viewer = await requireRole('admin');
  const { person: selectedId } = await searchParams;

  const data = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const roster = await listRoster(scope);

    // Only look up the selected person's entitlements if they are actually on
    // this roster. An id from another institute selects nobody rather than
    // producing an empty panel that confirms the id exists somewhere.
    const selected = selectedId
      ? (roster.find((entry) => entry.userId === selectedId) ?? null)
      : null;

    return {
      roster,
      access: await listRosterAccess(scope),
      selected,
      enrollments: selected
        ? await listEnrollmentDetails(scope, selected.userId)
        : [],
      sources: selected ? await listGrantableSources(scope) : [],
    };
  });

  const now = new Date();
  const byPerson = new Map<string, RosterAccess[]>();
  for (const row of data.access) {
    const held = byPerson.get(row.userId) ?? [];
    held.push(row);
    byPerson.set(row.userId, held);
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <header className="border-border flex flex-wrap items-end justify-between gap-5 border-b pb-[18px]">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-(length:--text-staff-page) leading-[1.2]">
            People
          </h1>
          <p className="text-muted-foreground max-w-[70ch] text-(length:--text-ui) leading-[1.6]">
            Members of {viewer.tenant.name}. Access is granted here or bought by
            the student, and both end up as the same entitlement.
          </p>
        </div>
        <InviteForm />
      </header>

      <div className="grid items-start gap-[26px] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="border-border bg-card overflow-hidden rounded-(--radius) border">
          <div className="border-border text-muted-foreground flex gap-4 border-b px-5 py-3 text-[0.6875rem] font-medium tracking-[0.1em] uppercase">
            <span className="flex-1">Member</span>
            <span className="w-[86px]">Role</span>
            <span className="hidden w-[150px] sm:block">Access</span>
            <span className="w-[74px] text-center">Status</span>
          </div>

          {data.roster.length === 0 ? (
            <p className="text-muted-foreground px-5 py-4 text-(length:--text-label)">
              Nobody yet. Invite them above.
            </p>
          ) : (
            data.roster.map((entry) => {
              const held = byPerson.get(entry.userId) ?? [];
              const live = held.some(
                (row) =>
                  row.expiresAt === null ||
                  row.expiresAt.getTime() > now.getTime(),
              );
              const chosen = entry.userId === data.selected?.userId;

              return (
                <Link
                  key={entry.userId}
                  href={`/settings/people?person=${entry.userId}`}
                  scroll={false}
                  aria-current={chosen ? 'true' : undefined}
                  className={`border-border flex items-center gap-4 border-b px-5 py-3.5 transition-colors last:border-b-0 ${
                    chosen ? 'bg-muted' : 'hover:bg-muted'
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-(length:--text-ui) font-medium">
                      {entry.name || entry.email}
                    </span>
                    <span className="text-muted-foreground truncate text-(length:--text-meta)">
                      {entry.email}
                    </span>
                  </span>

                  <span className="text-muted-foreground w-[86px] text-(length:--text-label) capitalize">
                    {entry.role}
                  </span>

                  <span className="hidden w-[150px] truncate text-(length:--text-label) sm:block">
                    {accessLine(held, now)}
                  </span>

                  {/*
                    Staff have standing without an entitlement, so calling them
                    lapsed would be wrong: they are not enrolled in anything and
                    were never meant to be.
                  */}
                  <span
                    className={`w-[74px] shrink-0 rounded-full px-1.5 py-1 text-center text-[0.71875rem] leading-none font-medium whitespace-nowrap ${
                      entry.role !== 'student'
                        ? 'bg-secondary text-secondary-foreground'
                        : live
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {entry.role !== 'student'
                      ? 'Staff'
                      : live
                        ? 'Active'
                        : 'Lapsed'}
                  </span>
                </Link>
              );
            })
          )}
        </div>

        <aside className="border-border bg-card flex flex-col gap-4 rounded-(--radius) border p-[22px] lg:sticky lg:top-20">
          {data.selected ? (
            <>
              <div className="flex flex-col gap-[3px]">
                <span className="font-serif text-[1.1875rem] leading-snug">
                  {data.selected.name || data.selected.email}
                </span>
                <span className="text-muted-foreground text-(length:--text-meta)">
                  {data.selected.email}
                </span>
                <Link
                  href={`/settings/people/${data.selected.userId}`}
                  className="text-muted-foreground w-fit text-(length:--text-meta) underline underline-offset-[3px]"
                >
                  What they told you at signup
                </Link>
              </div>

              <AccessPanel
                userId={data.selected.userId}
                enrollments={data.enrollments.map((enrollment) => ({
                  id: enrollment.id,
                  sourceKind: enrollment.sourceKind,
                  sourceTitle: enrollment.sourceTitle,
                  expiresAt: enrollment.expiresAt?.toISOString() ?? null,
                  granted: enrollment.grantedBy !== null,
                }))}
                sources={data.sources}
              />
            </>
          ) : (
            <p className="text-muted-foreground text-(length:--text-label) leading-[1.55]">
              Pick somebody from the list to see what they can reach, and to
              grant access by hand.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
