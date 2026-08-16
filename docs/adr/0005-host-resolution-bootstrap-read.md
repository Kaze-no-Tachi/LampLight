# 5. The bootstrap read: resolving a host to a tenant

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** PRD v0.2 section 5.2, requirement P0-1
- **Relates to:** ADR 0002, which this creates a deliberate exception to

## Context

ADR 0002 established that every tenant-owned table carries row-level security
keyed on the `app.tenant_id` session setting, and that queries which fail to
establish a tenant return zero rows.

Working out which tenant a request belongs to is the one read that cannot
satisfy that rule, because it is what establishes the tenant in the first
place. Hostnames live in `tenant_domains`, which is tenant-owned and therefore
policy-protected, so with no tenant set the lookup correctly returns nothing.
Something has to be permitted to make that one read, and it runs on the busiest
code path on the platform: every single request.

## Decision

A `SECURITY DEFINER` function, `resolve_tenant_by_host(text)`, applied in
migration 0002. It takes one hostname and returns at most one row containing a
tenant id and slug.

Five properties make it a narrow exception rather than a hole:

- **It cannot enumerate.** The function asks about the hostname it was given.
  There is no query shape that returns a second institute, so a bug in the
  caller cannot leak the platform's customer list. This is the property that
  decided it.
- **`SET search_path = ''`.** Search-path hijacking is the standard attack on
  `SECURITY DEFINER` functions. Every object it touches is schema-qualified.
- **It returns two columns.** Not the hostname list, not `cf_hostname_id`, not
  verification state, not counts.
- **It filters to verified domains and active tenants.** An unverified domain
  does not resolve, which is what stops someone pointing DNS at the platform
  and being served an institute's site before proving they own the name. A
  suspended institute stops resolving entirely.
- **`REVOKE ALL ... FROM PUBLIC`.** Only the application role may call it.

The companion lookup by subdomain slug needs no exception at all: `tenants` is
global and carries no policy.

## Consequences

**RLS is untouched.** Verified after the migration: a direct
`select count(*) from tenant_domains` as the application role with no tenant
context still returns zero rows. The function adds one controlled answer, it
does not widen the table.

**There are now two sanctioned bypasses, and they are not equivalent.**
`src/db/admin.ts` can read everything and is import-banned outside a short
allowlist. This function can answer one question and is safe to call from
anywhere. Reaching for the admin client to resolve a host would have been the
cheapest option and the worst one, because it puts the widest possible blast
radius on the most-executed path in the system.

**The alternative remains available.** A global `domain_routes` table needs no
bypass at all, since routing information is genuinely public: anyone can
resolve `institute.edu` and see what it serves. It was rejected because a
buggy query against it could enumerate every institute, which the function form
makes structurally impossible. If the function ever becomes awkward, that is
the fallback, and it is a downgrade in exactly one respect.

**Cache invalidation is now a correctness concern for phase 3.** Resolution is
cached in process for a minute, with misses cached for five seconds. When the
domain verification job flips a domain to active it must call
`invalidateTenantCache(hostname)`, or a newly verified domain appears broken
for up to five seconds after the operator watches it turn green.

## Alternatives considered

**Reuse `src/db/admin.ts`.** Cheapest, no migration, no new mechanism. Rejected
on blast radius, as above.

**A permissive RLS policy on `tenant_domains` for active rows.** Simple, and
the data is arguably public. Rejected because policies are OR-ed, so it would
let any tenant-scoped connection read every other institute's domains, turning
a routing need into a customer-list disclosure.

**Node.js middleware doing the lookup directly.** Would have removed a layer,
but the Node middleware runtime is still experimental in Next 15, and the Edge
runtime cannot load the Postgres driver. Resolution therefore happens in the
tenant layout, which runs under Node, and middleware only classifies the host.
