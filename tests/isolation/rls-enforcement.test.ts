import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getTenantDb } from '@/db/client';
import { CORNERSTONE, GRACE } from '@/db/seed-data';
import { TENANT_OWNED_TABLES } from '@/db/tenant-tables';

/**
 * Tests the database layer on its own, with no repository code involved.
 *
 * Where read-paths.test.ts asks "do the repositories filter correctly", this
 * asks the blunter question: if a query reaches Postgres with the wrong tenant
 * established, or with none at all, what comes back? The answer has to be
 * nothing, on every tenant-owned table, without exception.
 */

// A connection that deliberately never sets app.tenant_id, standing in for
// code that reached the database without establishing a tenant.
const unscopedPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
});

afterAll(async () => {
  await Promise.all([closeDb(), unscopedPool.end()]);
});

describe('row-level security enforcement', () => {
  it.each([...TENANT_OWNED_TABLES])(
    'returns zero rows from %s when no tenant is established',
    async (table) => {
      const result = await unscopedPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}"`,
      );

      expect(
        result.rows[0]?.count,
        `${table} returned rows to a connection with no app.tenant_id set. ` +
          'The policy must fail closed, not open',
      ).toBe('0');
    },
  );

  it.each([...TENANT_OWNED_TABLES])(
    'hides %s rows owned by another tenant',
    async (table) => {
      // Scoped to Grace, counting rows stamped with Cornerstone's id. The
      // WHERE clause names the other tenant explicitly, so this is not relying
      // on the repository layer to scope anything.
      const count = await getTenantDb(GRACE.id).run(async (scope) => {
        const result = await scope.tx.execute<{ count: string }>(
          sql`SELECT count(*)::text AS count FROM ${sql.identifier(table)}
              WHERE tenant_id = ${CORNERSTONE.id}`,
        );
        return result.rows[0]?.count;
      });

      expect(
        count,
        `${table} exposed Cornerstone rows to a connection scoped to Grace`,
      ).toBe('0');
    },
  );

  it('clears app.tenant_id when the transaction ends', async () => {
    await getTenantDb(GRACE.id).run(async (scope) => {
      const inside = await scope.tx.execute<{ value: string | null }>(
        sql`SELECT current_setting('app.tenant_id', true) AS value`,
      );
      expect(inside.rows[0]?.value).toBe(GRACE.id);
    });

    // set_config with is_local => true is scoped to the transaction, so the
    // connection going back to the pool must not carry the tenant with it.
    const after = await unscopedPool.query<{ value: string | null }>(
      `SELECT current_setting('app.tenant_id', true) AS value`,
    );
    expect(after.rows[0]?.value ?? '').toBe('');
  });

  it('refuses a tenant id that is not a uuid', () => {
    expect(() => getTenantDb("' OR '1'='1")).toThrow(/uuid/i);
  });

  it('blocks writing a row stamped with another tenant id', async () => {
    // The WITH CHECK half of the policy. Scoped to Grace, trying to insert a
    // Cornerstone row.
    await expect(
      getTenantDb(GRACE.id).run(async (scope) =>
        scope.tx.execute(
          sql`INSERT INTO audit_log (tenant_id, action)
              VALUES (${CORNERSTONE.id}, 'isolation-probe')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
