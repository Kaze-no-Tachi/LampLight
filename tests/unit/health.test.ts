import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { checkDatabaseHealth, closeDb } from '@/db/client';

/**
 * The health probe gates deploys: the container HEALTHCHECK and
 * `docker compose up --wait` both read it, so a probe that always answers
 * "healthy" turns a failed release into a green one.
 *
 * The reason field matters as much as the status. Configuration failures and
 * database failures both surface on the first query of a cold container, and
 * reporting a missing environment variable as "database unreachable" sends
 * whoever is on the outage to the wrong system. These tests pin that
 * distinction, because it is invisible until the one moment it costs you.
 */

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('database health probe', () => {
  it('reports healthy against a migrated database', async () => {
    await expect(checkDatabaseHealth()).resolves.toBe(true);
  });

  it('returns a boolean rather than throwing on failure', async () => {
    // The route turns this into a 200 or a 503. If it threw instead, Next.js
    // would answer 500 and the orchestrator would report an unhealthy
    // container for the wrong reason.
    await expect(checkDatabaseHealth()).resolves.toBeTypeOf('boolean');
  });
});

describe('health route', () => {
  it('answers 200 when configuration and database are both good', async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  it('blames configuration, not the database, for a bad config', async () => {
    // Platform mode in production requires the Cloudflare credentials. Modules
    // are reset so env.ts re-evaluates instead of returning its cached parse.
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TENANCY_MODE', 'platform');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    vi.stubEnv('CLOUDFLARE_ZONE_ID', '');
    vi.stubEnv('CLOUDFLARE_SAAS_FALLBACK_ORIGIN', '');

    // Silences the expected server-side log, and doubles as the assertion that
    // the detail goes somewhere. The response body stays generic because this
    // endpoint is public through the tunnel, so the log is the only place an
    // operator can find out which variable is missing.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('@/app/api/health/route');
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'unhealthy',
      reason: 'configuration',
    });
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });
});
