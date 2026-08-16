import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Self-serve signup is disabled by default, and that default is what makes
 * P0-5 true today.
 *
 * The response can be made uniform, and is, but an attacker who can sign up
 * can still test the password they chose: success means the address was new.
 * Only email verification closes that, and mail delivery is P1 while the
 * property it protects is P0. So until mail exists the endpoint changes
 * nothing, and answers identically either way so the setting is not probeable.
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

describe('self-serve signup flag', () => {
  it('is off unless explicitly enabled', async () => {
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    const { getEnv } = await import('@/env');
    expect(getEnv().SELF_SERVE_SIGNUP).toBe(false);
  });

  it('stays off for any value other than the exact string "true"', async () => {
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    vi.stubEnv('SELF_SERVE_SIGNUP', 'false');
    const { getEnv } = await import('@/env');
    expect(getEnv().SELF_SERVE_SIGNUP).toBe(false);
  });

  it('can be turned on once mail delivery exists', async () => {
    for (const [key, value] of Object.entries(BASE)) vi.stubEnv(key, value);
    vi.stubEnv('SELF_SERVE_SIGNUP', 'true');
    const { getEnv } = await import('@/env');
    expect(getEnv().SELF_SERVE_SIGNUP).toBe(true);
  });
});
