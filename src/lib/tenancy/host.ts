/**
 * Host header parsing. Pure functions, no database, no Node built-ins.
 *
 * That constraint is deliberate: Next.js middleware runs on the Edge runtime,
 * which cannot load the Postgres driver. So the classification that decides
 * where a request is routed happens here, and the database lookup that decides
 * whether the tenant actually exists happens later, in the tenant layout, which
 * runs under Node. Splitting it this way avoids depending on the experimental
 * Node middleware runtime.
 */

export type HostClassification =
  | { kind: 'apex' }
  | { kind: 'subdomain'; slug: string }
  | { kind: 'foreign'; host: string };

/**
 * Normalises a raw Host header for comparison and lookup.
 *
 * The Host header is attacker-controlled, so every difference that could make
 * two spellings of the same name compare unequal has to be removed before it
 * reaches a lookup. Otherwise `Grace.Lamplight.School.` and
 * `grace.lamplight.school` resolve differently, and cache keys multiply.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let host = raw.trim().toLowerCase();

  // IPv6 literals arrive bracketed, as [::1]:3000. Strip the port only when it
  // is outside the brackets, or the address itself gets truncated.
  //
  // They are canonicalized rather than rejected because normalization's job is
  // to produce one spelling of a host, not to decide whether that host belongs
  // to a tenant. Resolution answers the second question, and no tenant can
  // ever own an IP literal, so these end up null there instead.
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close === -1) return null;
    const literal = host.slice(0, close + 1);
    return /^\[[0-9a-f:]+\]$/.test(literal) ? literal : null;
  }

  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);

  // A fully qualified name may carry a trailing dot. It is the same host.
  if (host.endsWith('.')) host = host.slice(0, -1);

  if (host === '') return null;

  // Reject anything that is not plausibly a hostname before it reaches a query
  // or a cache key. Belt and braces: the lookup is parameterised anyway.
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.includes('..')) return null;

  return host;
}

/**
 * Decides whether a host is the platform apex, a tenant subdomain of it, or
 * something else entirely (which will be a custom domain, or nothing).
 *
 * Note that `www` is treated as the apex rather than as a tenant named "www".
 * Otherwise the marketing site at www would try to resolve a tenant, fail, and
 * 404 the front page.
 */
export function classifyHost(
  host: string,
  apexDomain: string,
): HostClassification {
  const apex = apexDomain.trim().toLowerCase();

  if (host === apex || host === `www.${apex}`) {
    return { kind: 'apex' };
  }

  if (host.endsWith(`.${apex}`)) {
    const label = host.slice(0, -(apex.length + 1));

    // Only a single label is a tenant slug. Deeper names under the apex are
    // not tenants, so `a.b.lamplight.school` is foreign rather than a tenant
    // called "a.b", which would never match a slug anyway.
    if (label.length > 0 && !label.includes('.')) {
      return { kind: 'subdomain', slug: label };
    }
  }

  return { kind: 'foreign', host };
}

/**
 * Slugs are the tenant's identity in a hostname, so they are constrained to
 * what is unambiguous in DNS: lowercase alphanumerics and internal hyphens.
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug);
}
