import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getEnv } from '@/env';
import { classifyHost, normalizeHost } from './host';
import { resolveTenant, type TenantContext } from './resolve';

/**
 * Request-scoped tenant access for server components and route handlers.
 *
 * Nothing in the application reads the Host header directly. It reads the
 * normalized value the middleware forwarded, so there is exactly one parser and
 * one set of rules about what a host means.
 */

const TENANT_HOST_HEADER = 'x-lamplight-host';

export async function getRequestHost(): Promise<string | null> {
  const headerList = await headers();
  // Falls back to the raw header so that anything bypassing middleware, such
  // as a direct route handler invocation in a test, still resolves.
  return (
    headerList.get(TENANT_HOST_HEADER) ?? normalizeHost(headerList.get('host'))
  );
}

/** True when the request arrived on the platform apex rather than a tenant. */
export async function isApexRequest(): Promise<boolean> {
  if (getEnv().TENANCY_MODE === 'single') return false;

  const host = await getRequestHost();
  if (!host) return false;

  return classifyHost(host, getEnv().TENANT_SUBDOMAIN_ROOT).kind === 'apex';
}

/** Returns the tenant for this request, or null when the host resolves to none. */
export async function getTenant(): Promise<TenantContext | null> {
  return resolveTenant(await getRequestHost());
}

/**
 * Returns the tenant, or renders the generic 404.
 *
 * Every failure lands on the same 404: unknown host, unverified domain,
 * suspended institute, malformed header. A visitor cannot tell a tenant that
 * does not exist from one that does but has no such page, which is what stops
 * the platform's institute list from being enumerable (PRD section 5.2).
 */
export async function requireTenant(): Promise<TenantContext> {
  const tenant = await getTenant();
  if (!tenant) notFound();
  return tenant;
}

/**
 * Guards routes that belong to the platform rather than to any institute.
 *
 * Enforced here rather than in middleware on purpose. Middleware cannot reach
 * the database, so it cannot make trustworthy decisions about tenants, and a
 * guard that lives next to the page it protects is harder to detach from it by
 * accident. A tenant host asking for /superadmin gets the same 404 as any
 * other unknown path, revealing nothing about the console's existence.
 */
export async function requireApex(): Promise<void> {
  if (!(await isApexRequest())) notFound();
}
