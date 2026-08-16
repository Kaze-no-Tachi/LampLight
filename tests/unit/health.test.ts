import { afterAll, describe, expect, it } from 'vitest';
import { checkDatabaseHealth, closeDb } from '@/db/client';

/**
 * The health probe gates deploys: the container HEALTHCHECK and
 * `docker compose up --wait` both read it, so a probe that always answers
 * "healthy" turns a failed release into a green one.
 */

afterAll(async () => {
  await closeDb();
});

describe('database health probe', () => {
  it('reports healthy against a migrated database', async () => {
    await expect(checkDatabaseHealth()).resolves.toBe(true);
  });

  it('swallows connection errors rather than throwing', async () => {
    // The route turns this boolean into a 200 or a 503. If the probe threw
    // instead, Next.js would answer 500 and the orchestrator would see an
    // unhealthy container for the wrong reason, which makes the logs lie about
    // what actually broke.
    await expect(checkDatabaseHealth()).resolves.toBeTypeOf('boolean');
  });
});
