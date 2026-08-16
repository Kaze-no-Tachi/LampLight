import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for a bug that would have broken every production deploy.
 *
 * The Cloudflare requirement used to live inside parseEnv, so it applied to
 * anything that imported this module. Migration tooling imports it through
 * getAdminDb, which meant the pre-deploy step every release runs
 * (`docker compose --profile tools run --rm migrate`) refused to start in
 * production for want of credentials it never uses. Caught by actually running
 * the migrator container, not by the suite, so the suite covers it now.
 *
 * The split under test: getEnv parses and validates what everything needs,
 * assertPlatformConfig adds what only the serving application needs.
 */

const PLATFORM_PRODUCTION = {
  NODE_ENV: 'production',
  TENANCY_MODE: 'platform',
  DATABASE_URL: 'postgres://app:pw@localhost:5432/lamplight',
  DATABASE_ADMIN_URL: 'postgres://admin:pw@localhost:5432/lamplight',
} as const;

function stub(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('environment validation', () => {
  it('lets tooling boot in platform production without Cloudflare credentials', async () => {
    // This is the migrator's exact situation. It must parse cleanly.
    stub({ ...PLATFORM_PRODUCTION });
    const { getEnv } = await import('@/env');

    expect(() => getEnv()).not.toThrow();
    expect(getEnv().TENANCY_MODE).toBe('platform');
  });

  it('still refuses to serve platform traffic without them', async () => {
    stub({ ...PLATFORM_PRODUCTION });
    const { assertPlatformConfig } = await import('@/env');

    expect(() => assertPlatformConfig()).toThrow(/CLOUDFLARE_API_TOKEN/);
  });

  it('passes once the credentials are supplied', async () => {
    stub({
      ...PLATFORM_PRODUCTION,
      CLOUDFLARE_API_TOKEN: 'token',
      CLOUDFLARE_ZONE_ID: 'zone',
      CLOUDFLARE_SAAS_FALLBACK_ORIGIN: 'origin.lamplight.school',
    });
    const { assertPlatformConfig } = await import('@/env');

    expect(() => assertPlatformConfig()).not.toThrow();
  });

  it('never applies the requirement to a self-hoster', async () => {
    // Single-tenant mode has no custom hostnames and no Cloudflare account.
    stub({
      ...PLATFORM_PRODUCTION,
      TENANCY_MODE: 'single',
      SINGLE_TENANT_SLUG: 'grace',
    });
    const { assertPlatformConfig } = await import('@/env');

    expect(() => assertPlatformConfig()).not.toThrow();
  });

  it('refuses to boot when the two database roles are the same', async () => {
    // Collapsing them means the app runs as the RLS-bypassing role, which
    // removes the database isolation layer with no other symptom.
    stub({
      ...PLATFORM_PRODUCTION,
      DATABASE_URL: 'postgres://admin:pw@localhost:5432/lamplight',
      DATABASE_ADMIN_URL: 'postgres://admin:pw@localhost:5432/lamplight',
    });
    const { getEnv } = await import('@/env');

    expect(() => getEnv()).toThrow(/must not equal DATABASE_ADMIN_URL/);
  });
});
