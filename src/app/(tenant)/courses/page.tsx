import Link from 'next/link';
import { getTenantDb } from '@/db/client';
import {
  listPublishedCourses,
  listPublishedPrograms,
} from '@/db/repositories/catalog';
import { getViewer } from '@/lib/auth/guards';
import { requireTenant } from '@/lib/tenancy/context';

/**
 * The catalog. Public, because a bible institute wants its courses findable.
 *
 * Only published rows appear, which the repository enforces, so an institute
 * can draft a course without it showing up. What a visitor sees here is titles
 * and prices; what they can actually hear is decided per lesson by the access
 * predicate, so nothing on this page needs to know who is looking.
 */
export const dynamic = 'force-dynamic';

/**
 * Programs carry no currency column of their own, unlike courses, so this
 * defaults where one is not supplied. Multi-currency is a P2 in the PRD, and
 * when it lands the currency belongs on the product rather than being passed
 * in at the call site like this.
 */
function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export default async function CatalogPage() {
  const tenant = await requireTenant();
  const viewer = await getViewer();

  const { courses, programs } = await getTenantDb(tenant.id).run(
    async (scope) => ({
      courses: await listPublishedCourses(scope),
      programs: await listPublishedPrograms(scope),
    }),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 p-8">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {tenant.name}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Courses</h1>
        <p className="text-muted-foreground">
          {viewer
            ? `Signed in as ${viewer.email}. Your enrolled courses open straight to the lessons.`
            : 'Every course has a free first lesson you can listen to without an account.'}
        </p>
      </header>

      {programs.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold tracking-tight">Programs</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {programs.map((program) => (
              <li
                key={program.id}
                className="flex flex-col gap-2 rounded-lg border p-4"
              >
                <span className="font-medium">{program.title}</span>
                <span className="text-muted-foreground text-sm">
                  {money(program.priceCents, 'usd')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Individual courses
        </h2>

        {courses.length === 0 ? (
          <p className="text-muted-foreground">
            Nothing published yet. Check back soon.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {courses.map((course) => (
              <li key={course.id} className="rounded-lg border p-4">
                <Link
                  href={`/courses/${course.slug}`}
                  className="flex flex-col gap-1"
                >
                  <span className="font-medium underline-offset-4 hover:underline">
                    {course.title}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {course.isStandalonePurchasable
                      ? money(course.priceCents, course.currency)
                      : 'Part of a program'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
