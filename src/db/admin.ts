import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnv } from '@/env';
import * as schema from './schema';
import type { AppDatabase } from './scope';

/**
 * THE UNSCOPED DATABASE CLIENT. READ THIS BEFORE IMPORTING IT.
 *
 * This client connects as the role in DATABASE_ADMIN_URL, which bypasses
 * row-level security. A query issued through it can read and write every
 * tenant's data. It exists for exactly three jobs:
 *
 *   1. Running migrations (src/db/migrate.ts).
 *   2. Seeding and resetting local or CI databases (src/db/seed.ts,
 *      src/db/reset.ts).
 *   3. Platform operator routes under src/app/(platform)/superadmin/**, where
 *      cross-tenant reads are the whole point and every action writes an
 *      audit_log row.
 *
 * The isolation harness also imports it, deliberately: running each read path
 * against a connection with RLS out of the way is how the suite proves the
 * application-layer tenant filters work on their own rather than being
 * covered for by the database.
 *
 * ESLint enforces that list (see eslint.config.mjs, ADMIN_CLIENT_ALLOWLIST).
 * Feature code uses getTenantDb(tenantId) from ./client instead. If you find
 * yourself wanting this client in a route handler, server action, or
 * component, the answer is almost always that the tenant id needs threading
 * through, not that the guard needs loosening.
 */

let pool: Pool | null = null;
let database: AppDatabase | null = null;

export function getAdminPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getEnv().DATABASE_ADMIN_URL, max: 5 });
  }
  return pool;
}

export function getAdminDb(): AppDatabase {
  database ??= drizzle(getAdminPool(), { schema });
  return database;
}

export async function closeAdminDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}
