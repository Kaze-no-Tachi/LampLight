import { redirect } from 'next/navigation';
import { primaryRedirectFor } from '@/lib/domains/redirect';
import { requireTenant } from '@/lib/tenancy/context';

/**
 * Never prerendered, and this is a correctness requirement rather than a
 * performance note. Everything below this layout is a function of the Host
 * header, so a single prerendered copy would be one institute's page served to
 * all of them. Next.js normally infers this from the headers() call, but that
 * inference is silent when it goes wrong, and it did: an earlier version threw
 * during prerender before headers() was ever reached, so the route was treated
 * as static. Stating it removes the guesswork.
 */
export const dynamic = 'force-dynamic';

/**
 * Everything an institute's students and staff see hangs off this layout, and
 * it resolves the tenant once for the whole subtree.
 *
 * This is where an unresolvable host becomes a 404, rather than in middleware.
 * Middleware runs on the Edge runtime and cannot reach Postgres, so it cannot
 * know whether a tenant exists. Deciding here means the decision is made by
 * code that can actually check.
 */
export default async function TenantLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Throws to the generic 404 when the host belongs to no active tenant.
  const tenant = await requireTenant();

  // Canonical domain (PRD section 5.3). Here rather than in middleware for the
  // same reason as the 404 above: knowing which of an institute's domains is
  // primary is a database question, and middleware cannot ask one.
  const canonical = await primaryRedirectFor(tenant);
  if (canonical) redirect(canonical);

  return <>{children}</>;
}
