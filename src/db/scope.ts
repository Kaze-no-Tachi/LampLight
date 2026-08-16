import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export type AppDatabase = NodePgDatabase<typeof schema>;

/**
 * The transaction handle handed to repository functions. It is always a
 * transaction rather than a bare connection because app.tenant_id is set with
 * set_config(..., is_local => true), which scopes the setting to the
 * transaction and guarantees it cannot survive back into the pool.
 */
export type TenantTransaction = Parameters<
  Parameters<AppDatabase['transaction']>[0]
>[0];

/**
 * The first parameter of every repository function.
 *
 * Carrying the tenant id alongside the transaction is redundant with the GUC
 * on purpose. Repositories filter on scope.tenantId explicitly (layer 1) while
 * RLS filters on the GUC (layer 2). The two agree because getTenantDb sets
 * both from the same value, and the isolation suite proves each layer works
 * with the other disabled.
 */
export type TenantScope = {
  readonly tenantId: string;
  readonly tx: TenantTransaction;
};

/**
 * A tenant-bound database handle. The only way to get one is getTenantDb,
 * and the only way to run a query with it is inside `run`, so there is no
 * path to a query that has not had its tenant established.
 */
export interface TenantDb {
  readonly tenantId: string;
  run<T>(fn: (scope: TenantScope) => Promise<T>): Promise<T>;
}
