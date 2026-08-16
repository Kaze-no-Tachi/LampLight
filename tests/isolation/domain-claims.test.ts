import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAdminDb, getAdminDb } from '@/db/admin';
import { closeDb, lookupTenantByHost } from '@/db/client';
import { tenantDomains } from '@/db/schema';
import { CORNERSTONE, GRACE } from '@/db/seed-data';

/**
 * Claiming a hostname is not exclusive. Verifying one is.
 *
 * The distinction is the whole reason the constraint changed shape. A plain
 * unique on hostname made a claim exclusive the moment it was typed, so any
 * institute could enter a competitor's domain and block them from ever
 * attaching it, owning nothing and proving nothing. These assert that the
 * looser constraint is still tight enough where it counts: exactly one
 * institute can serve a given hostname.
 */

const CONTESTED = 'contested.example.test';

async function claim(
  tenantId: string,
  hostname: string,
  status: 'pending' | 'active' = 'pending',
): Promise<string> {
  const id = randomUUID();
  await getAdminDb()
    .insert(tenantDomains)
    .values({
      id,
      tenantId,
      hostname,
      verificationStatus: status,
      verifiedAt: status === 'active' ? new Date() : null,
    });
  return id;
}

async function clearContested(): Promise<void> {
  await getAdminDb()
    .delete(tenantDomains)
    .where(inArray(tenantDomains.hostname, [CONTESTED]));
}

beforeEach(clearContested);

afterAll(async () => {
  await clearContested();
  await Promise.all([closeDb(), closeAdminDb()]);
});

describe('two institutes may claim the same hostname', () => {
  it('allows both pending claims, so neither can squat the other out', async () => {
    await claim(GRACE.id, CONTESTED);

    // The old plain unique rejected this, which is what made squatting work.
    await expect(claim(CORNERSTONE.id, CONTESTED)).resolves.toBeTruthy();
  });

  it('resolves to nobody while both are unproven', async () => {
    await claim(GRACE.id, CONTESTED);
    await claim(CORNERSTONE.id, CONTESTED);

    // Only active domains resolve, so a contested name serves no one until
    // somebody proves ownership.
    await expect(lookupTenantByHost(CONTESTED)).resolves.toBeNull();
  });
});

describe('only one institute may serve it', () => {
  it('refuses a second active row for the same hostname', async () => {
    await claim(GRACE.id, CONTESTED);
    await claim(CORNERSTONE.id, CONTESTED);

    await getAdminDb()
      .update(tenantDomains)
      .set({ verificationStatus: 'active', verifiedAt: new Date() })
      .where(
        and(
          eq(tenantDomains.tenantId, GRACE.id),
          eq(tenantDomains.hostname, CONTESTED),
        ),
      );

    // Cornerstone's losing claim cannot be promoted afterwards. Two active
    // rows would make resolution return whichever the planner reached first,
    // which is one institute's site served at another's address.
    await expect(
      getAdminDb()
        .update(tenantDomains)
        .set({ verificationStatus: 'active', verifiedAt: new Date() })
        .where(
          and(
            eq(tenantDomains.tenantId, CORNERSTONE.id),
            eq(tenantDomains.hostname, CONTESTED),
          ),
        ),
    ).rejects.toThrow(/unique|duplicate/i);

    const resolved = await lookupTenantByHost(CONTESTED);
    expect(resolved?.id).toBe(GRACE.id);
  });

  it('still refuses one institute claiming the same name twice', async () => {
    await claim(GRACE.id, CONTESTED);
    await expect(claim(GRACE.id, CONTESTED)).rejects.toThrow(
      /unique|duplicate/i,
    );
  });
});
