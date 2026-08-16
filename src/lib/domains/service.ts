import { and, eq, ne } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import { findDomain, listDomains } from '@/db/repositories/domains';
import type { DomainRecord } from '@/db/repositories/domains';
import { auditLog, tenantDomains } from '@/db/schema';
import {
  CloudflareError,
  createCustomHostnameClient,
  customHostnamesConfigured,
  type CustomHostnameClient,
} from '@/lib/cloudflare/custom-hostnames';
import { claimableHostname } from '@/lib/tenancy/host';
import { invalidateTenantCache } from '@/lib/tenancy/resolve';
import { getEnv } from '@/env';

/**
 * Attaching, checking, and removing an institute's own domains
 * (PRD section 5.3, requirement P0-4).
 *
 * Every function here takes the tenant id from a caller that has already
 * checked the admin role, and writes through getTenantDb, so row-level
 * security applies on top of the explicit filters. An institute cannot touch
 * another's domain rows even if a filter were dropped.
 */

/** How long an unverified claim lives before the sweep releases it. */
const CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type AttachResult =
  { status: 'ok'; domain: DomainRecord } | { status: 'error'; message: string };

export async function attachDomain(
  tenantId: string,
  rawHostname: string,
  client: CustomHostnameClient | null = null,
): Promise<AttachResult> {
  const env = getEnv();

  if (!customHostnamesConfigured()) {
    return {
      status: 'error',
      message:
        'Custom domains are not configured on this instance. Ask the operator.',
    };
  }

  const claim = claimableHostname(rawHostname, env.PLATFORM_APEX_DOMAIN);
  if (!claim.ok) {
    return {
      status: 'error',
      message:
        claim.reason === 'platform'
          ? `Names under ${env.PLATFORM_APEX_DOMAIN} belong to the platform. Use a domain you own.`
          : 'That does not look like a domain name.',
    };
  }

  const existing = await getTenantDb(tenantId).run(async (scope) => {
    const rows = await scope.tx
      .select({ id: tenantDomains.id })
      .from(tenantDomains)
      .where(
        and(
          eq(tenantDomains.tenantId, scope.tenantId),
          eq(tenantDomains.hostname, claim.hostname),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });

  if (existing) {
    return { status: 'error', message: 'You have already added that domain.' };
  }

  let created;
  try {
    created = await (client ?? createCustomHostnameClient()).create(
      claim.hostname,
    );
  } catch (error) {
    return { status: 'error', message: explain(error) };
  }

  const domain = await getTenantDb(tenantId).run(async (scope) => {
    const inserted = await scope.tx
      .insert(tenantDomains)
      .values({
        tenantId: scope.tenantId,
        hostname: claim.hostname,
        verificationStatus: created.status,
        cfHostnameId: created.id,
        dnsRecordsJson: created.records,
        claimExpiresAt: new Date(Date.now() + CLAIM_TTL_MS),
      })
      .returning({ id: tenantDomains.id });

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      action: 'domain.attached',
      targetType: 'tenant_domain',
      targetId: inserted[0]?.id ?? null,
      metadataJson: { hostname: claim.hostname },
    });

    return inserted[0]?.id ? findDomain(scope, inserted[0].id) : null;
  });

  return domain
    ? { status: 'ok', domain }
    : { status: 'error', message: 'Could not save that domain.' };
}

/**
 * Re-reads one domain's status from Cloudflare and records it.
 *
 * Called when an admin looks at the settings page, because that is the moment
 * somebody is actually waiting on the answer, and again by the sweep for the
 * case where nobody is watching.
 */
export async function refreshDomain(
  tenantId: string,
  domainId: string,
  client: CustomHostnameClient | null = null,
): Promise<DomainRecord | null> {
  const current = await getTenantDb(tenantId).run((scope) =>
    findDomain(scope, domainId),
  );
  if (!current?.cfHostnameId) return current;
  if (!customHostnamesConfigured()) return current;

  let latest;
  try {
    latest = await (client ?? createCustomHostnameClient()).get(
      current.cfHostnameId,
    );
  } catch (error) {
    // Cloudflare being unreachable is not the domain failing. Recording that
    // as a failure would tell an institute their DNS is wrong when it is not.
    if (error instanceof CloudflareError && error.kind === 'unavailable') {
      return current;
    }
    return recordError(tenantId, domainId, explain(error));
  }

  const becameActive =
    latest.status === 'active' && current.status !== 'active';

  const updated = await getTenantDb(tenantId).run(async (scope) => {
    await scope.tx
      .update(tenantDomains)
      .set({
        verificationStatus: latest.status,
        dnsRecordsJson: latest.records,
        lastError: latest.message,
        verifiedAt: latest.status === 'active' ? new Date() : null,
        // A live domain does not expire. Clearing this is what takes the
        // hostname out of the sweep's reach.
        claimExpiresAt:
          latest.status === 'active'
            ? null
            : new Date(Date.now() + CLAIM_TTL_MS),
      })
      .where(
        and(
          eq(tenantDomains.tenantId, scope.tenantId),
          eq(tenantDomains.id, domainId),
        ),
      );

    return findDomain(scope, domainId);
  });

  // Misses are cached for a few seconds, so without this a domain that just
  // went active keeps 404ing for people who tried it a moment too early.
  if (becameActive) invalidateTenantCache(current.hostname);

  return updated;
}

/** Refreshes every domain of one institute. Used by the settings page. */
export async function refreshAllDomains(
  tenantId: string,
  client: CustomHostnameClient | null = null,
): Promise<DomainRecord[]> {
  const current = await getTenantDb(tenantId).run((scope) =>
    listDomains(scope),
  );

  for (const domain of current) {
    // Active domains are not re-checked on every page view. Cloudflare renews
    // certificates without being asked, and the sweep still catches a domain
    // that later stops working.
    if (domain.status === 'active') continue;
    await refreshDomain(tenantId, domain.id, client);
  }

  return getTenantDb(tenantId).run((scope) => listDomains(scope));
}

export async function removeDomain(
  tenantId: string,
  domainId: string,
  client: CustomHostnameClient | null = null,
): Promise<void> {
  const domain = await getTenantDb(tenantId).run((scope) =>
    findDomain(scope, domainId),
  );
  if (!domain) return;

  // Cloudflare first. Deleting our row while Cloudflare still manages the
  // hostname would leave the name occupied with nothing pointing at it, and
  // nobody, including us, able to claim it again.
  if (domain.cfHostnameId && customHostnamesConfigured()) {
    try {
      await (client ?? createCustomHostnameClient()).remove(
        domain.cfHostnameId,
      );
    } catch (error) {
      if (error instanceof CloudflareError && error.kind === 'unavailable') {
        throw error;
      }
      // Anything else means Cloudflare no longer has it, which is the state
      // we were trying to reach.
    }
  }

  await getTenantDb(tenantId).run(async (scope) => {
    await scope.tx
      .delete(tenantDomains)
      .where(
        and(
          eq(tenantDomains.tenantId, scope.tenantId),
          eq(tenantDomains.id, domainId),
        ),
      );

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      action: 'domain.removed',
      targetType: 'tenant_domain',
      targetId: domainId,
      metadataJson: { hostname: domain.hostname },
    });
  });

  invalidateTenantCache(domain.hostname);
}

/**
 * Marks one domain primary, which is where the others redirect to.
 *
 * Only an active domain may be primary. Pointing the redirect at a hostname
 * that does not resolve yet takes a working site down in exchange for one that
 * is still waiting on DNS.
 */
export async function setPrimaryDomain(
  tenantId: string,
  domainId: string,
): Promise<boolean> {
  return getTenantDb(tenantId).run(async (scope) => {
    const target = await findDomain(scope, domainId);
    if (!target || target.status !== 'active') return false;

    await scope.tx
      .update(tenantDomains)
      .set({ isPrimary: false })
      .where(
        and(
          eq(tenantDomains.tenantId, scope.tenantId),
          ne(tenantDomains.id, domainId),
        ),
      );

    await scope.tx
      .update(tenantDomains)
      .set({ isPrimary: true })
      .where(
        and(
          eq(tenantDomains.tenantId, scope.tenantId),
          eq(tenantDomains.id, domainId),
        ),
      );

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      action: 'domain.primary_changed',
      targetType: 'tenant_domain',
      targetId: domainId,
      metadataJson: { hostname: target.hostname },
    });

    invalidateTenantCache();
    return true;
  });
}

/**
 * Deletes claims that were never verified before they lapsed.
 *
 * Our own table stopped making a claim exclusive (ADR 0001, migration 0006),
 * but Cloudflare's custom hostname record still is: one name, one record,
 * platform-wide. So an abandoned claim keeps occupying the name at Cloudflare
 * even though nothing in our database blocks anybody, and the institute that
 * actually owns the domain would be told it is "already managed elsewhere"
 * with no way to find out by whom. This is what releases it.
 *
 * Returns how many were released, so a sweep that quietly does nothing is
 * distinguishable from one that had nothing to do.
 */
export async function releaseLapsedClaims(
  tenantId: string,
  client: CustomHostnameClient | null = null,
): Promise<number> {
  const domains = await getTenantDb(tenantId).run((scope) =>
    listDomains(scope),
  );

  const lapsed = domains.filter(
    (domain) =>
      domain.status !== 'active' &&
      domain.claimExpiresAt !== null &&
      domain.claimExpiresAt.getTime() <= Date.now(),
  );

  for (const domain of lapsed) {
    await removeDomain(tenantId, domain.id, client);
  }

  return lapsed.length;
}

async function recordError(
  tenantId: string,
  domainId: string,
  message: string,
): Promise<DomainRecord | null> {
  return getTenantDb(tenantId).run(async (scope) => {
    await scope.tx
      .update(tenantDomains)
      .set({ verificationStatus: 'failed', lastError: message })
      .where(
        and(
          eq(tenantDomains.tenantId, scope.tenantId),
          eq(tenantDomains.id, domainId),
        ),
      );
    return findDomain(scope, domainId);
  });
}

/**
 * Turns a Cloudflare failure into something the reader can act on.
 *
 * An institute admin is the reader here, so a rejected API token becomes "ask
 * the operator" rather than a message about a credential they cannot see and
 * would only be confused by.
 */
function explain(error: unknown): string {
  if (!(error instanceof CloudflareError)) {
    return 'Something went wrong adding that domain.';
  }

  switch (error.kind) {
    case 'taken':
      return 'That hostname is already managed elsewhere. If it is yours, remove it from the other provider first.';
    case 'auth':
      return 'Custom domains are misconfigured on this instance. Ask the operator.';
    case 'unavailable':
      return 'Could not reach Cloudflare just now. Try again in a moment.';
    case 'invalid':
      return `Cloudflare would not accept that hostname: ${error.message}`;
  }
}
