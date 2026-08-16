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

export type HostnameClaim =
  | { ok: true; hostname: string }
  | { ok: false; reason: 'malformed' | 'platform' };

/**
 * Whether an institute may claim a hostname as its own (PRD section 5.3).
 *
 * THE ONE THAT MATTERS IS THE PLATFORM CHECK.
 *
 * Resolution tries verified custom domains first and falls through to parsing a
 * subdomain of the platform apex. An institute allowed to claim
 * `other.lamplight.school` would therefore win that name outright, because a
 * verified row beats slug parsing, and would be serving its own site at another
 * institute's address. Claiming the bare apex would take the marketing site and
 * the superadmin console with it.
 *
 * So nothing at or under the platform apex is ever claimable. Institutes get
 * their subdomain from their slug, which only provisioning can set. This is
 * enforced here, in one pure function, rather than in the form that happens to
 * be the way in today.
 *
 * Everything else is shape checking. Whether the institute actually owns
 * `institute.edu` is not something this can know and not something it tries to
 * guess: that is what the DNS ownership record proves, and until Cloudflare
 * confirms it the domain does not resolve.
 */
export function claimableHostname(
  candidate: string,
  apexDomain: string,
): HostnameClaim {
  // Checked before normalizing, because normalizeHost strips a port. Silently
  // turning `institute.edu:8443` into a claim on `institute.edu` would hand
  // somebody exclusive rights to a name they did not quite type, and a port
  // means nothing here anyway: Cloudflare for SaaS serves 443 and only 443.
  if (candidate.includes(':')) return { ok: false, reason: 'malformed' };

  const hostname = normalizeHost(candidate);
  if (!hostname) return { ok: false, reason: 'malformed' };

  // Must be a dotted name of ordinary DNS labels. Rules out bare labels,
  // addresses, wildcards, and anything with a path or scheme smuggled in.
  const labels = hostname.split('.');
  if (labels.length < 2 || hostname.length > 253) {
    return { ok: false, reason: 'malformed' };
  }
  if (!labels.every((label) => isValidSlug(label))) {
    return { ok: false, reason: 'malformed' };
  }
  // A final label of digits only means somebody typed an IP address.
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) {
    return { ok: false, reason: 'malformed' };
  }

  const apex = apexDomain.trim().toLowerCase();
  if (hostname === apex || hostname.endsWith(`.${apex}`)) {
    return { ok: false, reason: 'platform' };
  }

  return { ok: true, hostname };
}

/**
 * Builds an absolute URL on a given host.
 *
 * Links in mail have to be absolute, and they have to point at the institute
 * the person is joining rather than at whatever base URL the auth library was
 * configured with. That configuration is a single value and therefore cannot
 * be right for more than one institute, which is exactly how an invitation
 * ends up sending someone to another institute's domain to type a password.
 *
 * Scheme is derived rather than configured: loopback and .localhost get http
 * because nothing local terminates TLS, everything else gets https because
 * every real deployment sits behind Cloudflare or Caddy.
 */
export function absoluteUrl(host: string, path: string): string {
  const hostname = host.split(':')[0] ?? host;
  const local =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';

  return `${local ? 'http' : 'https'}://${host}${path}`;
}
