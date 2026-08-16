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

export type ResolvedTenant = { id: string; slug: string; name: string };

/**
 * THE BOOTSTRAP READS. There are exactly two, and they live here rather than
 * in a repository because repositories take a TenantScope, and these are what
 * produce one.
 *
 * Every other read in the codebase runs with app.tenant_id established.
 * Working out which tenant a request belongs to obviously cannot, so these two
 * functions are the only queries that run without it. They are kept adjacent
 * to getTenantDb so the exception is visible next to the rule, and both are
 * deliberately incapable of returning more than one tenant.
 *
 * Neither uses the RLS-bypassing admin client:
 *
 *   By host: goes through resolve_tenant_by_host, a SECURITY DEFINER function
 *   that takes one hostname and answers only about that hostname. Enumerating
 *   the platform's institutes through it is not possible, because there is no
 *   query shape that asks for more than one. See drizzle/0002 and ADR 0005.
 *
 *   By slug: reads `tenants`, which is a global table with no RLS at all, so
 *   no exception of any kind is needed.
 *
 * Both filter to active tenants, so a suspended institute stops resolving and
 * its domains start behaving like domains that were never registered.
 */
export async function lookupTenantByHost(
  host: string,
): Promise<ResolvedTenant | null> {
  const result = await getDatabase().execute<{
    tenant_id: string;
    tenant_slug: string;
    tenant_name: string;
  }>(
    sql`select tenant_id, tenant_slug, tenant_name from resolve_tenant_by_host(${host})`,
  );

  const row = result.rows[0];
  return row
    ? { id: row.tenant_id, slug: row.tenant_slug, name: row.tenant_name }
    : null;
}

export async function lookupTenantBySlug(
  slug: string,
): Promise<ResolvedTenant | null> {
  const result = await getDatabase().execute<{
    id: string;
    slug: string;
    name: string;
  }>(
    sql`select id, slug, name from tenants where slug = ${slug} and status = 'active' limit 1`,
  );

  const row = result.rows[0];
  return row ? { id: row.id, slug: row.slug, name: row.name } : null;
}

/**
 * Is this user a platform operator?
 *
 * `platform_admins` is global and carries no policy, like `users`, so this
 * needs no tenant context and no bypass. It is a membership test against one
 * user id and cannot list the operators.
 *
 * Being a platform admin deliberately grants nothing on its own. It gates the
 * superadmin console, and the console is what uses the RLS-bypassing client.
 * A platform admin browsing an institute's domain is still just whatever their
 * membership there says they are, which is usually nothing.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const result = await getDatabase().execute<{ exists: boolean }>(
    sql`select exists(select 1 from platform_admins where user_id = ${userId}) as exists`,
  );
  return result.rows[0]?.exists === true;
}

export type GlobalAccount = { id: string; emailVerified: boolean };

/**
 * Finds the account holding an address, anywhere on the platform.
 *
 * THE MOST DANGEROUS ANSWER IN THE CODEBASE. Read before calling.
 *
 * `users` is global, so this crosses every institute by construction. Whether
 * a row comes back is exactly the fact PRD requirement P0-5 says must never
 * reach a visitor: knowing an address is registered tells you that person
 * studies somewhere on this platform, and over a list of addresses that is a
 * roster of a competitor's students.
 *
 * So the rule for callers is absolute. The result may decide which message is
 * sent to that address, and it may decide what somebody who already proved
 * control of that mailbox is shown. It must never change what an anonymous
 * caller can observe: not a status code, not a response body, not a redirect.
 *
 * It is here beside the other exceptions rather than in a repository because
 * repositories take a TenantScope and this deliberately has none.
 */
export async function findAccountByEmail(
  email: string,
): Promise<GlobalAccount | null> {
  const result = await getDatabase().execute<{
    id: string;
    email_verified: boolean;
  }>(
    sql`select id, email_verified from users
        where email = ${email.trim().toLowerCase()} limit 1`,
  );

  const row = result.rows[0];
  return row ? { id: row.id, emailVerified: row.email_verified } : null;
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
