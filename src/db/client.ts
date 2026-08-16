import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnv } from '@/env';
import * as schema from './schema';
import type { AppDatabase, TenantDb, TenantScope } from './scope';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pool: Pool | null = null;
let database: AppDatabase | null = null;

/**
 * The application pool. It connects as the role in DATABASE_URL, which must
 * not hold BYPASSRLS. Everything that goes through this pool is subject to the
 * tenant_isolation policies.
 */
function getPool(): Pool {
  if (!pool) {
    const env = getEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
    });
  }
  return pool;
}

function getDatabase(): AppDatabase {
  database ??= drizzle(getPool(), { schema });
  return database;
}

/**
 * Returns a tenant-bound handle.
 *
 * Every unit of work opens a transaction and sets app.tenant_id as a
 * transaction-local setting. Transaction-local matters: a session-level SET
 * would survive when the connection returns to the pool, and the next
 * checkout, possibly serving a different tenant, would inherit it. With
 * is_local => true, Postgres clears the value at commit or rollback.
 *
 * If the GUC is never set, current_setting('app.tenant_id', true) returns
 * null, the policy predicate evaluates to null rather than true, and every
 * tenant-owned table returns zero rows. The failure mode is closed, not open.
 */
export function getTenantDb(tenantId: string): TenantDb {
  if (!UUID_PATTERN.test(tenantId)) {
    // Caught here rather than at the ::uuid cast inside the policy, so a bad
    // value produces a clear error instead of a Postgres syntax exception
    // halfway through a request.
    throw new Error(
      `getTenantDb requires a uuid tenant id, received: ${tenantId}`,
    );
  }

  return {
    tenantId,
    run<T>(fn: (scope: TenantScope) => Promise<T>): Promise<T> {
      return getDatabase().transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.tenant_id', ${tenantId}, true)`,
        );
        return fn({ tenantId, tx });
      });
    },
  };
}

/**
 * Health probe for the container HEALTHCHECK and /api/health.
 *
 * Reads `tenants`, which is deliberate. A bare `select 1` proves only that a
 * socket opened. Counting a real table proves the connection authenticated,
 * the schema is migrated, and the application role still holds its grants,
 * which are the three ways this actually breaks in production.
 *
 * `tenants` is a global table with no RLS policy, so this needs no tenant
 * context and is not a tenant read path.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await getDatabase().execute(sql`select count(*) from tenants`);
    return true;
  } catch {
    return false;
  }
}

/** Closes the pool. Used by tests and by graceful shutdown, not by requests. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    database = null;
  }
}
