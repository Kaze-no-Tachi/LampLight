import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { listActiveTenantIds } from '@/db/client';
import { sweepInvitations } from '@/lib/auth/invitations';
import { customHostnamesConfigured } from '@/lib/cloudflare/custom-hostnames';
import { refreshAllDomains, releaseLapsedClaims } from '@/lib/domains/service';
import { getEnv } from '@/env';

/**
 * Periodic maintenance, run by cron.
 *
 * Two jobs today, and a home for the next one:
 *
 *   Domains. Poll Cloudflare for every unverified hostname and release claims
 *   that have lapsed (PRD section 5.3, step 4).
 *
 *   Invitations. Delete the ones that have outlived their purpose. Expired
 *   unconsumed rows hold an address, a name, and whatever an institute asked
 *   at signup, belonging to somebody who never became a user, and keeping that
 *   because nothing forced us to delete it is the wrong default here.
 *
 * WHY AN ENDPOINT RATHER THAN A SCHEDULER
 *
 * The stack is one VPS running Docker Compose (ADR 0004). There is no job
 * runner and adding one for a single periodic task would be the largest new
 * moving part in the deployment. Cron hitting a URL is a well understood thing
 * an operator can see, run by hand, and reason about when it stops working.
 *
 * The settings page already refreshes on view, which covers the case somebody
 * is waiting on. This covers the case nobody is watching: a domain that
 * verifies overnight should be live in the morning, not when an admin next
 * happens to look.
 *
 * WHY IT DOES NOT USE THE CROSS-TENANT CLIENT
 *
 * The work spans every institute, which is the usual excuse for reaching past
 * row-level security. It does not need to. It lists tenant ids from the global
 * `tenants` table, then does per-institute work through an ordinary tenant
 * scope, so every read and write here is subject to the same policy as a
 * request. Cross-tenant work does not have to mean unscoped work.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const secret = getEnv().DOMAIN_SWEEP_SECRET;

  // Unconfigured means the endpoint does not exist, not that it is disabled.
  // A 401 here would confirm the path to anybody scanning for it.
  if (!secret) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  const offered = request.headers.get('x-lamplight-sweep-secret') ?? '';
  if (!secretsMatch(offered, secret)) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  const tenantIds = await listActiveTenantIds();
  const domainsEnabled = customHostnamesConfigured();

  let refreshed = 0;
  let released = 0;
  let expired = 0;
  let spent = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    try {
      // Invitation cleanup first, and outside the Cloudflare branch, because
      // it has to happen on a self-hosted instance and on a platform whose
      // Cloudflare credentials are missing. Tying data retention to an
      // unrelated integration being configured is how a table quietly grows
      // for a year.
      const invitations = await sweepInvitations(tenantId);
      expired += invitations.expired;
      spent += invitations.spent;

      if (domainsEnabled) {
        const domains = await refreshAllDomains(tenantId);
        refreshed += domains.length;
        released += await releaseLapsedClaims(tenantId);
      }
    } catch {
      // One institute's trouble must not stop the sweep for the rest. The
      // count is reported so a silent partial run is visible.
      failed += 1;
    }
  }

  return NextResponse.json(
    {
      status: 'ok',
      tenants: tenantIds.length,
      domains: { refreshed, released, enabled: domainsEnabled },
      invitations: { expired, spent },
      failed,
    },
    { status: 200 },
  );
}

/**
 * Constant-time comparison, so the shared secret cannot be recovered a byte at
 * a time by measuring how long the rejection takes.
 */
function secretsMatch(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
