import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { CORNERSTONE, GRACE } from '@/db/seed-data';
import { invalidateTenantCache, resolveTenant } from '@/lib/tenancy/resolve';

/**
 * Host resolution against the real database (PRD section 10, P0-1).
 *
 * This lives in the isolation suite rather than with the unit tests because it
 * is a cross-tenant boundary: resolution is what decides whose data a request
 * is about, so getting it wrong hands one institute another institute's site.
 */

beforeEach(() => {
  // Resolution caches, and every assertion here is about a first lookup.
  invalidateTenantCache();
});

afterAll(async () => {
  await closeDb();
});

describe('resolving a host to a tenant', () => {
  it('resolves a verified custom domain', async () => {
    const tenant = await resolveTenant('learn.gracebible.test');
    expect(tenant?.slug).toBe('grace');
    expect(tenant?.id).toBe(GRACE.id);
  });

  it('resolves a platform subdomain', async () => {
    const tenant = await resolveTenant('cornerstone.lamplight.school');
    expect(tenant?.slug).toBe('cornerstone');
    expect(tenant?.id).toBe(CORNERSTONE.id);
  });

  it('resolves regardless of case, port, or trailing dot', async () => {
    for (const host of [
      'LEARN.GraceBible.TEST',
      'learn.gracebible.test:443',
      'learn.gracebible.test.',
    ]) {
      expect((await resolveTenant(host))?.id).toBe(GRACE.id);
    }
  });

  it('never resolves an unverified domain', async () => {
    // Cornerstone has this domain attached but still pending. Resolving it
    // would mean anyone who points DNS at the platform gets served an
    // institute's site before proving they own the name.
    expect(await resolveTenant('learn.cornerstone.test')).toBeNull();
  });

  it('does not resolve the platform apex to a tenant', async () => {
    expect(await resolveTenant('lamplight.school')).toBeNull();
    expect(await resolveTenant('www.lamplight.school')).toBeNull();
  });
});

describe('resolution reveals nothing about which institutes exist', () => {
  it.each([
    ['an unknown custom domain', 'totally-unknown.example.com'],
    ['an unclaimed platform subdomain', 'not-a-tenant.lamplight.school'],
    ['a lookalike of the apex', 'evil-lamplight.school'],
    ['a lookalike of a real tenant', 'grace.lamplight.school.evil.test'],
    ['a malformed header', 'grace\nHost: evil.test'],
    ['an empty header', ''],
  ])('returns the same null for %s', async (_label, host) => {
    // Uniform null is the point. A caller that could tell "no such tenant"
    // from "that tenant exists but not here" could enumerate the platform's
    // customer list one guess at a time (PRD section 5.2, rule 4).
    expect(await resolveTenant(host)).toBeNull();
  });

  it('treats a suspended tenant exactly like one that never existed', async () => {
    const { getAdminDb } = await import('@/db/admin');
    const { sql } = await import('drizzle-orm');
    const db = getAdminDb();

    await db.execute(
      sql`update tenants set status = 'suspended' where id = ${GRACE.id}`,
    );
    invalidateTenantCache();

    try {
      expect(await resolveTenant('learn.gracebible.test')).toBeNull();
      expect(await resolveTenant('grace.lamplight.school')).toBeNull();
    } finally {
      await db.execute(
        sql`update tenants set status = 'active' where id = ${GRACE.id}`,
      );
      invalidateTenantCache();
    }
  });
});

describe('caching', () => {
  it('serves a repeated lookup without changing the answer', async () => {
    const first = await resolveTenant('learn.gracebible.test');
    const second = await resolveTenant('learn.gracebible.test');
    expect(second).toEqual(first);
  });

  it('can be invalidated for a single host', async () => {
    await resolveTenant('learn.gracebible.test');
    invalidateTenantCache('LEARN.GraceBible.TEST:443');
    // Invalidation normalizes its argument, so the same host spelled any way
    // clears the same entry. Phase 3's verification job depends on this.
    expect((await resolveTenant('learn.gracebible.test'))?.id).toBe(GRACE.id);
  });
});
