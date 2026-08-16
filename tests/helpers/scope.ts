import { sql } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { getTenantDb } from '@/db/client';
import type { TenantScope } from '@/db/scope';

/**
 * The two ways the isolation suite runs a read path.
 *
 * 'both-layers' goes through getTenantDb, so the query runs as the application
 * role with row-level security enforcing the tenant on top of whatever the
 * repository function filters on. This is production behaviour.
 *
 * 'app-layer-only' runs the exact same repository function against the
 * RLS-bypassing admin connection. The database stops filtering anything, so
 * the only thing standing between the caller and another tenant's rows is the
 * `eq(table.tenantId, scope.tenantId)` inside the repository.
 *
 * Running both matters. If the suite only ever ran with RLS active, deleting a
 * tenant filter from a repository function would still pass, because the
 * database would quietly cover for the mistake. The application layer would rot
 * undetected until the day something ran as a bypassing role: a superadmin
 * route, a migration, a self-hoster with one connection string. Testing the
 * layers separately is what keeps both of them real.
 */
export type IsolationMode = 'both-layers' | 'app-layer-only';

export const ISOLATION_MODES: IsolationMode[] = [
  'both-layers',
  'app-layer-only',
];

export async function withScope<T>(
  mode: IsolationMode,
  tenantId: string,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  if (mode === 'both-layers') {
    return getTenantDb(tenantId).run(fn);
  }

  return getAdminDb().transaction(async (tx) => {
    // Set for symmetry with the real path. The admin role bypasses RLS, so
    // this has no effect on visibility here, which is exactly the point.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn({ tenantId, tx });
  });
}
