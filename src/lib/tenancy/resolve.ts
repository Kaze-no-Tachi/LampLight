import {
  lookupTenantByHost,
  lookupTenantBySlug,
  type ResolvedTenant,
} from '@/db/client';
import { getEnv } from '@/env';
import { TtlCache } from '@/lib/cache/ttl-cache';
import { classifyHost, isValidSlug, normalizeHost } from './host';

/**
 * Host to tenant resolution (PRD section 5.2), the read that runs before every
 * other read on the platform.
 */

export type TenantContext = {
  readonly id: string;
  readonly slug: string;
  /** The institute's display name, for page titles, headers, and mail. */
  readonly name: string;
  /** The normalized host the request arrived on. */
  readonly host: string;
};

const CACHE_MAX_ENTRIES = 1_000;
const HIT_TTL_MS = 60_000;

/**
 * Misses are cached too, and for much less time.
 *
 * Without negative caching, spraying random hostnames is a free way to make
 * every request hit Postgres, since a miss would never be remembered. With it,
 * the spray answers from memory. The TTL is short because a miss is the state
 * that changes when an institute finishes onboarding, and waiting a minute for
 * a domain you just verified to start working feels broken.
 */
const MISS_TTL_MS = 5_000;

type CacheEntry = TenantContext | 'miss';

const cache = new TtlCache<CacheEntry>(CACHE_MAX_ENTRIES, HIT_TTL_MS);

/** Exposed for tests and for the domain verification job in phase 3. */
export function invalidateTenantCache(host?: string): void {
  if (host) {
    const normalized = normalizeHost(host);
    if (normalized) cache.delete(normalized);
    return;
  }
  cache.clear();
}

/**
 * Resolves the tenant for a request host, or null when there is none.
 *
 * Null covers every failure the same way on purpose: unknown host, unverified
 * domain, suspended tenant, and malformed header are indistinguishable to the
 * caller, which renders a generic 404. Distinguishing them would let anyone
 * probe which institutes exist on the platform (PRD section 5.2, rule 4).
 */
export async function resolveTenant(
  rawHost: string | null | undefined,
): Promise<TenantContext | null> {
  const env = getEnv();

  // Self-host mode: one institute, one hostname, no lookup. The tenant is
  // whatever the operator pinned, whatever host the request arrived on.
  if (env.TENANCY_MODE === 'single') {
    return resolveSingleTenant(rawHost);
  }

  const host = normalizeHost(rawHost);
  if (!host) return null;

  const cached = cache.get(host);
  if (cached) return cached === 'miss' ? null : cached;

  const resolved = await lookupUncached(host, env.TENANT_SUBDOMAIN_ROOT);

  if (!resolved) {
    cache.set(host, 'miss', MISS_TTL_MS);
    return null;
  }

  const context: TenantContext = { ...resolved, host };
  cache.set(host, context);
  return context;
}

async function lookupUncached(
  host: string,
  subdomainRoot: string,
): Promise<ResolvedTenant | null> {
  const classification = classifyHost(host, subdomainRoot);

  // The apex is the marketing site and the superadmin console. It is never a
  // tenant, and must not become one just because someone creates a tenant
  // whose slug collides.
  if (classification.kind === 'apex') return null;

  // A custom domain is by far the more common case in production, since every
  // live institute has one, so it is tried first. A verified row here also
  // wins over slug parsing, which lets a tenant keep a subdomain working after
  // it has been renamed.
  const byHost = await lookupTenantByHost(host);
  if (byHost) return byHost;

  if (classification.kind === 'subdomain' && isValidSlug(classification.slug)) {
    return lookupTenantBySlug(classification.slug);
  }

  return null;
}

async function resolveSingleTenant(
  rawHost: string | null | undefined,
): Promise<TenantContext | null> {
  const slug = getEnv().SINGLE_TENANT_SLUG;
  // env validation guarantees this in single mode, but the type is optional
  // because the same schema serves platform mode.
  if (!slug) return null;

  const host = normalizeHost(rawHost) ?? slug;
  const cacheKey = `single:${slug}`;

  const cached = cache.get(cacheKey);
  if (cached && cached !== 'miss') return { ...cached, host };

  const tenant = await lookupTenantBySlug(slug);
  if (!tenant) return null;

  const context: TenantContext = { ...tenant, host };
  cache.set(cacheKey, context);
  return context;
}
