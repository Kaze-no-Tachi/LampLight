import Link from 'next/link';
import { getTenantDb } from '@/db/client';
import { listRoster } from '@/db/repositories/entitlements';
import { requireRole } from '@/lib/auth/guards';
import { InviteForm } from './invite-form';

/**
 * Who belongs to this institute (PRD requirement P0-11, the roster half).
 *
 * Admin only. An instructor can see the students in their own courses, which is
 * a different and narrower question, and it belongs on the course rather than
 * here.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'People' };

export default async function PeoplePage() {
  const viewer = await requireRole('admin');

  const roster = await getTenantDb(viewer.tenant.id).run((scope) =>
    listRoster(scope),
  );

  const students = roster.filter((person) => person.role === 'student');
  const staff = roster.filter((person) => person.role !== 'student');

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="text-muted-foreground">
          Everyone who belongs to this institute, and what each of them can
          reach. Enrolling somebody here does not involve payment: use it for
          scholarships, students who paid another way, and staff who need to see
          a course.
        </p>
      </div>

      <InviteForm />

      <Group title="Staff" people={staff} />
      <Group
        title="Students"
        people={students}
        empty="No students yet. Invite them above, or enrol somebody who is already here."
      />
    </main>
  );
}

function Group({
  title,
  people,
  empty,
}: {
  title: string;
  people: {
    userId: string;
    email: string;
    name: string;
    role: string;
    enrollmentCount: number;
  }[];
  empty?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">
        {title}{' '}
        <span className="text-muted-foreground text-sm font-normal">
          ({people.length})
        </span>
      </h2>

      {people.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty ?? 'Nobody.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {people.map((person) => (
            <li
              key={person.userId}
              className="bg-card border-border rounded-(--radius) border p-3"
            >
              <Link
                href={`/settings/people/${person.userId}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <span className="font-medium underline-offset-4 hover:underline">
                  {person.name || person.email}
                </span>
                {person.name && (
                  <span className="text-muted-foreground text-sm">
                    {person.email}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto text-sm">
                  {person.role}
                  {person.role === 'student' &&
                    `, ${person.enrollmentCount} ${
                      person.enrollmentCount === 1
                        ? 'enrollment'
                        : 'enrollments'
                    }`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
