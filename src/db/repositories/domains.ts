import { and, asc, eq } from 'drizzle-orm';
import { tenantDomains } from '@/db/schema';
import type { TenantScope } from '@/db/scope';
import type { DnsRecord } from '@/lib/cloudflare/custom-hostnames';

/**
 * Custom domain reads, tenant scoped like every other repository.
 *
 * Worth stating plainly because this table is the one exception elsewhere:
 * `resolve_tenant_by_host` reads tenant_domains without a tenant scope, since
 * it is what establishes one. That is the bootstrap read, it lives in
 * src/db/client.ts beside the other exceptions, and it can only ever answer
 * about a single hostname. Everything in this file is the ordinary path, where
 * an institute is asking about its own domains and the scope already exists.
 */

export type DomainRecord = {
  id: string;
  hostname: string;
  isPrimary: boolean;
  status: 'pending' | 'verifying' | 'active' | 'failed';
  dnsRecords: DnsRecord[];
  lastError: string | null;
  verifiedAt: Date | null;
  claimExpiresAt: Date | null;
  cfHostnameId: string | null;
};

function toRecord(row: {
  id: string;
  hostname: string;
  isPrimary: boolean;
  verificationStatus: 'pending' | 'verifying' | 'active' | 'failed';
  dnsRecordsJson: unknown;
  lastError: string | null;
  verifiedAt: Date | null;
  claimExpiresAt: Date | null;
  cfHostnameId: string | null;
}): DomainRecord {
  return {
    id: row.id,
    hostname: row.hostname,
    isPrimary: row.isPrimary,
    status: row.verificationStatus,
    dnsRecords: Array.isArray(row.dnsRecordsJson)
      ? (row.dnsRecordsJson as DnsRecord[])
      : [],
    lastError: row.lastError,
    verifiedAt: row.verifiedAt,
    claimExpiresAt: row.claimExpiresAt,
    cfHostnameId: row.cfHostnameId,
  };
}

const COLUMNS = {
  id: tenantDomains.id,
  hostname: tenantDomains.hostname,
  isPrimary: tenantDomains.isPrimary,
  verificationStatus: tenantDomains.verificationStatus,
  dnsRecordsJson: tenantDomains.dnsRecordsJson,
  lastError: tenantDomains.lastError,
  verifiedAt: tenantDomains.verifiedAt,
  claimExpiresAt: tenantDomains.claimExpiresAt,
  cfHostnameId: tenantDomains.cfHostnameId,
} as const;

export async function listDomains(scope: TenantScope): Promise<DomainRecord[]> {
  const rows = await scope.tx
    .select(COLUMNS)
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, scope.tenantId))
    .orderBy(asc(tenantDomains.createdAt));

  return rows.map(toRecord);
}

export async function findDomain(
  scope: TenantScope,
  id: string,
): Promise<DomainRecord | null> {
  const rows = await scope.tx
    .select(COLUMNS)
    .from(tenantDomains)
    .where(
      and(eq(tenantDomains.tenantId, scope.tenantId), eq(tenantDomains.id, id)),
    )
    .limit(1);

  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * The institute's primary hostname, which non-primary verified domains
 * redirect to (PRD section 5.3).
 *
 * Only an active domain can be primary as far as this is concerned. Redirecting
 * to a hostname that does not resolve yet would take a working site down in
 * exchange for a domain that is still waiting on DNS.
 */
export async function findPrimaryDomain(
  scope: TenantScope,
): Promise<DomainRecord | null> {
  const rows = await scope.tx
    .select(COLUMNS)
    .from(tenantDomains)
    .where(
      and(
        eq(tenantDomains.tenantId, scope.tenantId),
        eq(tenantDomains.isPrimary, true),
        eq(tenantDomains.verificationStatus, 'active'),
      ),
    )
    .limit(1);

  return rows[0] ? toRecord(rows[0]) : null;
}
