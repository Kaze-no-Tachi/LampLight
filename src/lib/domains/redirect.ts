import { headers } from 'next/headers';
import { getTenantDb } from '@/db/client';
import { findPrimaryDomain } from '@/db/repositories/domains';
import { absoluteUrl } from '@/lib/tenancy/host';
import type { TenantContext } from '@/lib/tenancy/resolve';

/**
 * Where a non-primary domain should send a visitor, or null to stay put
 * (PRD section 5.3).
 *
 * An institute that has attached `learn.institute.edu` and kept its platform
 * subdomain wants one canonical address. Two live addresses split search
 * ranking, and worse for this product, split sessions: cookies are host-only,
 * so somebody signed in on one and browsing the other is signed out with no
 * explanation.
 *
 * THREE THINGS THIS DELIBERATELY WILL NOT DO
 *
 * It will not redirect to a domain that is not verified. Pointing traffic at a
 * hostname that does not resolve yet takes a working site down in exchange for
 * one that is still waiting on DNS.
 *
 * It will not drop the path or the query string. Activation and password reset
 * links are issued on whichever host the person was using at the time, and an
 * institute can make a different domain primary the next day. A redirect that
 * loses the token turns every outstanding link into a dead end.
 *
 * It will not be permanent, despite the PRD saying 301. See the note in
 * docs/adr/0007.
 */
export async function primaryRedirectFor(
  tenant: TenantContext,
): Promise<string | null> {
  const primary = await getTenantDb(tenant.id).run((scope) =>
    findPrimaryDomain(scope),
  );

  if (!primary) return null;
  if (primary.hostname === tenant.host) return null;

  const headerList = await headers();
  // Next puts the full request path, query included, in this header. Falling
  // back to the bare root would silently drop a token rather than fail loudly,
  // so an absent header means no redirect at all.
  const target = headerList.get('x-lamplight-path');
  if (!target) return null;

  return absoluteUrl(primary.hostname, target);
}
