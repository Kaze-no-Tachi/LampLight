import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signup is gated twice, and the two gates are not interchangeable.
 *
 * SELF_SERVE_SIGNUP is the platform kill switch, on by default now that
 * signup creates an invitation rather than an account. It defaulted to false
 * while signup created accounts, because an attacker could submit an address
 * and then test the password they had just chosen: success meant the address
 * was new. Deferring activation removed the difference, so the reason for the
 * default went with it.
 *
 * tenant_settings.signup_mode is the institute's own decision and defaults to
 * closed. That is the gate that actually keeps strangers out, and it is the
 * one that stays shut until an institute says otherwise. Its default is
 * asserted in tests/unit/seed-data.test.ts against the schema, and its effect
 * on the endpoint is covered end to end by the Playwright suite.
 */

const BASE = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/lamplight',
  DATABASE_ADMIN_URL: 'postgres://admin:pw@localhost:5432/lamplight',
} as const;

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the platform signup kill switch', () => {
  it('is on by default, because the oracle it guarded is closed', async () => {
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    const { getEnv } = await import('@/env');
    expect(getEnv().SELF_SERVE_SIGNUP).toBe(true);
  });

  it('turns every institute off at once when set to false', async () => {
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    vi.stubEnv('SELF_SERVE_SIGNUP', 'false');
    const { getEnv } = await import('@/env');
    expect(getEnv().SELF_SERVE_SIGNUP).toBe(false);
  });

  it('accepts only the exact strings, so a typo fails loudly', async () => {
    // A permissive coercion here would read "no" or "0" as true, which is the
    // wrong direction to be wrong in for a switch that opens signup.
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    vi.stubEnv('SELF_SERVE_SIGNUP', 'no');
    const { getEnv } = await import('@/env');
    expect(() => getEnv()).toThrow(/SELF_SERVE_SIGNUP/);
  });
});
