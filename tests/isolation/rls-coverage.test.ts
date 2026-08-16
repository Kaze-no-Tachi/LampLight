import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeAdminDb, getAdminDb } from '@/db/admin';
import { GLOBAL_TABLES, TENANT_OWNED_TABLES } from '@/db/tenant-tables';

/**
 * Structural coverage, checked against the live database rather than the
 * source. A policy that was never applied, or a table added without one, fails
 * here instead of leaking in production.
 */

type PolicyRow = {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: number;
  has_tenant_id: boolean;
};

async function loadTableSecurity(): Promise<PolicyRow[]> {
  const result = await getAdminDb().execute<PolicyRow>(sql`
    SELECT
      c.relname::text AS table_name,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced,
      count(p.polname)::int AS policy_count,
      bool_or(a.attname = 'tenant_id') AS has_tenant_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r'
    GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
    ORDER BY c.relname
  `);

  return [...result.rows];
}

afterAll(async () => {
  await closeAdminDb();
});

describe('row-level security coverage', () => {
  it('protects every table listed as tenant owned', async () => {
    const rows = await loadTableSecurity();
    const byName = new Map(rows.map((row) => [row.table_name, row]));

    for (const table of TENANT_OWNED_TABLES) {
      const row = byName.get(table);

      expect(row, `${table} is registered as tenant owned but does not exist`).toBeDefined();
      if (!row) continue;

      expect(row.has_tenant_id, `${table} has no tenant_id column`).toBe(true);
      expect(row.rls_enabled, `${table} does not have RLS enabled`).toBe(true);
      expect(
        row.rls_forced,
        `${table} does not FORCE RLS, so the owning role bypasses every policy`,
      ).toBe(true);
      expect(
        row.policy_count,
        `${table} has RLS enabled but no policy, which denies all access`,
      ).toBeGreaterThan(0);
    }
  });

  it('has no unregistered table carrying a tenant_id column', async () => {
    const rows = await loadTableSecurity();

    const unregistered = rows
      .filter((row) => row.has_tenant_id)
      .map((row) => row.table_name)
      .filter((name) => !TENANT_OWNED_TABLES.includes(name as never));

    expect(
      unregistered,
      'these tables have a tenant_id column but are missing from ' +
        'TENANT_OWNED_TABLES, so they have no RLS policy',
    ).toEqual([]);
  });

  it('accounts for every table as either tenant owned or deliberately global', async () => {
    const rows = await loadTableSecurity();

    const unaccounted = rows
      .map((row) => row.table_name)
      .filter(
        (name) =>
          !TENANT_OWNED_TABLES.includes(name as never) &&
          !GLOBAL_TABLES.includes(name as never),
      );

    expect(
      unaccounted,
      'these tables are in neither TENANT_OWNED_TABLES nor GLOBAL_TABLES. ' +
        'Decide which one applies, and if global, say why in the review',
    ).toEqual([]);
  });
});
