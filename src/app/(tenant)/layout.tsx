import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/guards';
import { primaryRedirectFor } from '@/lib/domains/redirect';
import { requireTenant } from '@/lib/tenancy/context';
import { loadBranding } from '@/lib/theme/branding';
import { SiteFooter, SiteHeader, ThemeStyle } from './chrome';
import { PlayerProvider } from './player/player-provider';
import { RsuiteProvider } from './rsuite-provider';

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
 * The tab, which belongs to the institute rather than to the platform.
 *
 * Same host-dependence as everything else here, so it cannot be static
 * metadata on the root layout.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await requireTenant();
  const branding = await loadBranding(tenant);

  return {
    title: { default: branding.name, template: `%s | ${branding.name}` },
    description: branding.copy.hero,
    ...(branding.faviconUrl ? { icons: { icon: branding.faviconUrl } } : {}),
  };
}

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

  // After the redirect check, so a request that is about to be redirected
  // somewhere else does not pay for a brand nobody will see.
  const branding = await loadBranding(tenant);
  const viewer = await getViewer();

  return (
    <>
      <ThemeStyle branding={branding} />
      {/*
        The player wraps the whole subtree so that it is mounted once and never
        unmounted. That is what "survives navigation" means in the App Router:
        a client component in the layout keeps its state and its DOM while the
        page under it changes. The bottom padding leaves room for the bar it
        renders, so a footer is never trapped underneath it.
      */}
      <RsuiteProvider>
        <PlayerProvider>
          <div className="flex min-h-screen flex-col pb-24">
            <SiteHeader branding={branding} viewer={viewer} />
            <div className="flex-1">{children}</div>
            <SiteFooter branding={branding} />
          </div>
        </PlayerProvider>
      </RsuiteProvider>
    </>
  );
}
