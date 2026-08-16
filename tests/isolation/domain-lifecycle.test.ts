import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAdminDb, getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb, lookupTenantByHost } from '@/db/client';
import { listDomains } from '@/db/repositories/domains';
import { tenantDomains } from '@/db/schema';
import { CORNERSTONE, GRACE } from '@/db/seed-data';
import type {
  CustomHostname,
  CustomHostnameClient,
} from '@/lib/cloudflare/custom-hostnames';
import {
  attachDomain,
  refreshDomain,
  releaseLapsedClaims,
  removeDomain,
  setPrimaryDomain,
} from '@/lib/domains/service';

/**
 * The domain lifecycle, with Cloudflare replaced by a stub.
 *
 * Everything the platform actually decides happens on this side of the API
 * call: when a claim becomes exclusive, what an institute is allowed to claim
 * at all, when a domain starts resolving, and when an abandoned claim is
 * released. None of that needs credentials to test, and none of it should wait
 * for a real Cloudflare account to exist.
 */

const HOSTNAME = 'lifecycle.example.test';

function stubClient(overrides: Partial<CustomHostname> = {}): {
  client: CustomHostnameClient;
  removed: string[];
  setStatus(status: CustomHostname['status']): void;
} {
  const removed: string[] = [];
  let status: CustomHostname['status'] = overrides.status ?? 'verifying';

  const hostname = (): CustomHostname => ({
    id: 'cf-lifecycle',
    hostname: HOSTNAME,
    records:
      status === 'active'
        ? [
            {
              type: 'CNAME',
              name: HOSTNAME,
              value: 'origin.lamplight.school',
              purpose: 'routing',
            },
          ]
        : [
            {
              type: 'CNAME',
              name: HOSTNAME,
              value: 'origin.lamplight.school',
              purpose: 'routing',
            },
            {
              type: 'TXT',
              name: `_cf-custom-hostname.${HOSTNAME}`,
              value: 'ownership-token',
              purpose: 'ownership',
            },
          ],
    message: null,
    ...overrides,
    // Last, so setStatus wins over anything the caller fixed up front.
    status,
  });

  return {
    client: {
      async create() {
        return hostname();
      },
      async get() {
        return hostname();
      },
      async remove(id) {
        removed.push(id);
      },
    },
    removed,
    setStatus(next) {
      status = next;
    },
  };
}

async function clearDomains(): Promise<void> {
  await getAdminDb()
    .delete(tenantDomains)
    .where(inArray(tenantDomains.hostname, [HOSTNAME]));
}

/**
 * Puts the seeded primary flags back.
 *
 * These tests are the first in the suite to mutate a seeded row rather than
 * only read it, and marking a domain primary necessarily clears the flag on
 * the institute's other domains. Files share one database and one fork, so
 * leaving Grace with no primary made read-paths.test.ts fail several tests
 * later with nothing to point at the cause.
 */
async function restoreSeededPrimaries(): Promise<void> {
  for (const tenant of [GRACE, CORNERSTONE]) {
    for (const domain of tenant.domains) {
      await getAdminDb()
        .update(tenantDomains)
        .set({ isPrimary: domain.isPrimary })
        .where(eq(tenantDomains.id, domain.id));
    }
  }
}

beforeEach(clearDomains);

afterAll(async () => {
  await clearDomains();
  await restoreSeededPrimaries();
  await Promise.all([closeDb(), closeAdminDb()]);
});

describe('attaching a domain', () => {
  it('stores the records Cloudflare asked for, and does not resolve yet', async () => {
    const stub = stubClient();

    const result = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.domain.dnsRecords.map((record) => record.type)).toEqual([
      'CNAME',
      'TXT',
    ]);

    // The institute has not proven anything yet, so the hostname must serve
    // nobody. This is the property that makes an unproven claim harmless.
    await expect(lookupTenantByHost(HOSTNAME)).resolves.toBeNull();
  });

  it('refuses a name under the platform apex', async () => {
    const stub = stubClient();

    const result = await attachDomain(
      GRACE.id,
      'cornerstone.lamplight.school',
      stub.client,
    );

    // Resolution prefers a verified custom domain over slug parsing, so this
    // would have handed Grace another institute's address.
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toMatch(/belong to the platform/i);
    }
  });

  it('refuses the same domain twice for one institute', async () => {
    const stub = stubClient();
    await attachDomain(GRACE.id, HOSTNAME, stub.client);

    const again = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    expect(again.status).toBe('error');
  });

  it('lets a second institute claim the same name while it is unproven', async () => {
    const stub = stubClient();
    await attachDomain(GRACE.id, HOSTNAME, stub.client);

    // Not an error: a pending claim blocks nobody, which is what stops one
    // institute squatting a competitor's domain.
    const other = await attachDomain(CORNERSTONE.id, HOSTNAME, stub.client);
    expect(other.status).toBe('ok');
  });
});

describe('verification', () => {
  it('starts resolving only once Cloudflare says it is live', async () => {
    const stub = stubClient();
    const attached = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    if (attached.status !== 'ok') throw new Error('attach failed');

    await expect(lookupTenantByHost(HOSTNAME)).resolves.toBeNull();

    stub.setStatus('active');
    const refreshed = await refreshDomain(
      GRACE.id,
      attached.domain.id,
      stub.client,
    );

    expect(refreshed?.status).toBe('active');
    // Misses are cached, so this also proves the cache was invalidated. Without
    // that, a domain that just went live keeps 404ing for anybody who tried it
    // a moment too early.
    const resolved = await lookupTenantByHost(HOSTNAME);
    expect(resolved?.id).toBe(GRACE.id);
  });

  it('clears the claim expiry once verified, so the sweep leaves it alone', async () => {
    const stub = stubClient();
    const attached = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    if (attached.status !== 'ok') throw new Error('attach failed');
    expect(attached.domain.claimExpiresAt).not.toBeNull();

    stub.setStatus('active');
    const refreshed = await refreshDomain(
      GRACE.id,
      attached.domain.id,
      stub.client,
    );

    expect(refreshed?.claimExpiresAt).toBeNull();
  });

  it('does not mark a domain failed when Cloudflare is merely unreachable', async () => {
    const attached = await attachDomain(
      GRACE.id,
      HOSTNAME,
      stubClient().client,
    );
    if (attached.status !== 'ok') throw new Error('attach failed');

    const unreachable: CustomHostnameClient = {
      async create() {
        throw new Error('unused');
      },
      async get() {
        const { CloudflareError } =
          await import('@/lib/cloudflare/custom-hostnames');
        throw new CloudflareError('unavailable', 'socket hang up');
      },
      async remove() {},
    };

    const refreshed = await refreshDomain(
      GRACE.id,
      attached.domain.id,
      unreachable,
    );

    // Recording this as a failure would tell an institute their DNS is wrong
    // when the only thing wrong is our side of the connection.
    expect(refreshed?.status).not.toBe('failed');
  });
});

describe('releasing an abandoned claim', () => {
  it('deletes it at Cloudflare too, or the name stays occupied', async () => {
    const stub = stubClient();
    const attached = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    if (attached.status !== 'ok') throw new Error('attach failed');

    await getAdminDb()
      .update(tenantDomains)
      .set({ claimExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(tenantDomains.id, attached.domain.id));

    const released = await releaseLapsedClaims(GRACE.id, stub.client);

    expect(released).toBe(1);
    // Our table stopped making a claim exclusive; Cloudflare's record still
    // is. Leaving it there tells the institute that actually owns the domain
    // it is "already managed elsewhere", with no way to find out by whom.
    expect(stub.removed).toEqual(['cf-lifecycle']);

    const remaining = await getTenantDb(GRACE.id).run((scope) =>
      listDomains(scope),
    );
    expect(remaining.some((row) => row.hostname === HOSTNAME)).toBe(false);
  });

  it('leaves a verified domain alone however old it is', async () => {
    const stub = stubClient();
    const attached = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    if (attached.status !== 'ok') throw new Error('attach failed');

    stub.setStatus('active');
    await refreshDomain(GRACE.id, attached.domain.id, stub.client);

    expect(await releaseLapsedClaims(GRACE.id, stub.client)).toBe(0);
  });
});

describe('the primary domain', () => {
  it('cannot be one that does not resolve yet', async () => {
    const stub = stubClient();
    const attached = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    if (attached.status !== 'ok') throw new Error('attach failed');

    // Redirecting to a hostname that is still waiting on DNS takes a working
    // site down in exchange for one that does not work at all.
    await expect(setPrimaryDomain(GRACE.id, attached.domain.id)).resolves.toBe(
      false,
    );
  });

  it('moves off whichever domain held it', async () => {
    const stub = stubClient();
    const attached = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    if (attached.status !== 'ok') throw new Error('attach failed');

    stub.setStatus('active');
    await refreshDomain(GRACE.id, attached.domain.id, stub.client);
    await expect(setPrimaryDomain(GRACE.id, attached.domain.id)).resolves.toBe(
      true,
    );

    const domains = await getTenantDb(GRACE.id).run((scope) =>
      listDomains(scope),
    );
    // Exactly one, or the redirect target depends on row order.
    expect(domains.filter((row) => row.isPrimary)).toHaveLength(1);
    expect(domains.find((row) => row.isPrimary)?.hostname).toBe(HOSTNAME);
  });
});

describe('removing a domain', () => {
  it('stops it resolving', async () => {
    const stub = stubClient();
    const attached = await attachDomain(GRACE.id, HOSTNAME, stub.client);
    if (attached.status !== 'ok') throw new Error('attach failed');

    stub.setStatus('active');
    await refreshDomain(GRACE.id, attached.domain.id, stub.client);
    expect((await lookupTenantByHost(HOSTNAME))?.id).toBe(GRACE.id);

    await removeDomain(GRACE.id, attached.domain.id, stub.client);

    // A removed domain that keeps resolving from cache would serve an
    // institute's site at an address it has given up.
    await expect(lookupTenantByHost(HOSTNAME)).resolves.toBeNull();
  });
});
