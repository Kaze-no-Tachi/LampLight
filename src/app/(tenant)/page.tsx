import Link from 'next/link';
import { getTenantDb } from '@/db/client';
import {
  listPublishedCourses,
  listPublishedPrograms,
} from '@/db/repositories/catalog';
import { requireTenant } from '@/lib/tenancy/context';
import { loadBranding } from '@/lib/theme/branding';

/**
 * The institute's front door.
 *
 * Every word on it except the course titles comes from copy_json, so an
 * institute that has written its own hero and about text gets those, and one
 * that has not gets a sentence built from its name rather than an empty page
 * (see src/lib/theme/copy.ts).
 */
export const dynamic = 'force-dynamic';

export default async function TenantHome() {
  const tenant = await requireTenant();
  const branding = await loadBranding(tenant);

  const { courses, programs } = await getTenantDb(tenant.id).run(
    async (scope) => ({
      courses: await listPublishedCourses(scope),
      programs: await listPublishedPrograms(scope),
    }),
  );

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16">
      <section className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {branding.copy.tagline}
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance">
          {branding.copy.hero}
        </h1>
        <p className="text-muted-foreground max-w-2xl leading-relaxed">
          {branding.copy.about}
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            href="/catalogue"
            className="bg-primary text-primary-foreground rounded-(--radius) px-4 py-2 text-sm font-medium"
          >
            Browse courses
          </Link>
          <Link
            href="/sign-in"
            className="border-border rounded-(--radius) border px-4 py-2 text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </section>

      {programs.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold tracking-tight">
            Programs of study
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {programs.map((program) => (
              <li
                key={program.id}
                className="bg-card border-border rounded-(--radius) border p-5"
              >
                <p className="font-medium">{program.title}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  A structured course of study.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {courses.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight">Courses</h2>
            <Link href="/catalogue" className="text-sm hover:underline">
              See all {courses.length}
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {/* The front page is a taste, not the catalog. The catalog is one
                click away and does not need reproducing here. */}
            {courses.slice(0, 4).map((course) => (
              <li
                key={course.id}
                className="bg-card border-border rounded-(--radius) border p-5"
              >
                <Link
                  href={`/catalogue/${course.slug}`}
                  className="font-medium"
                >
                  {course.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
