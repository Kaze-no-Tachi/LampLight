# 2. Row-level security as the second isolation layer

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** PRD v0.2 section 5.1, open question N1

## Context

ADR 0001 chose a shared schema, which puts tenant isolation in the hands of
application code. Every read has to remember its `WHERE tenant_id = ...`. In a
codebase that will grow through nine more phases, "remember every time" is not
a security control. It is a hope.

The PRD raises this as open question N1: enforce RLS from day one, or land it
in week 3 once the application layer is proven?

## Decision

Row-level security from day one, on every tenant-owned table, applied by a
checked-in migration.

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
```

Four details carry the weight:

**The GUC fails closed.** `app_current_tenant_id()` reads
`current_setting('app.tenant_id', true)`, where the second argument means
"return null if unset" rather than raising. A null makes the policy predicate
null, which is not true, which filters the row out. Code that reaches the
database without establishing a tenant sees an empty table, not a full one.

**FORCE, not just ENABLE.** `ENABLE` leaves the table owner exempt. The
application is not supposed to connect as the owner, but a self-hoster wiring
one connection string for everything would silently lose the entire database
layer with no signal. `FORCE` closes that. A role holding `BYPASSRLS` still
bypasses, which is what the superadmin path relies on.

**Two roles, and the app refuses to start if they are the same.**
`DATABASE_URL` is the application role, with no `BYPASSRLS`. `DATABASE_ADMIN_URL`
is the migration and superadmin role, which bypasses. `src/env.ts` throws at
boot if the two connection strings match, because collapsing them is the one
misconfiguration that removes this layer invisibly.

**Transaction-local, not session-local.** `getTenantDb` sets the GUC with
`set_config('app.tenant_id', $1, true)`. The `true` scopes it to the
transaction. A session-level `SET` would survive when the connection returned
to the pool, and the next checkout, possibly serving a different institute,
would inherit it. That is a cross-tenant leak caused by the isolation mechanism
itself, and it is a well-worn way to get this wrong.

## Consequences

**No single mistake leaks data.** A forgotten `WHERE` returns zero rows instead
of another institute's students. A forgotten tenant context returns zero rows
instead of everything.

**Testing has to work harder, and this is the interesting part.** With RLS
active, a repository function that lost its tenant filter still returns correct
results, because the database quietly covers for it. A suite that only ran in
production configuration would pass while the application layer rotted, and the
rot would surface the first time something ran as a bypassing role: a superadmin
route, a migration, a self-hoster with one connection string.

So the isolation harness runs every read path twice, once through the
application role with RLS enforcing and once through the RLS-bypassing role
with only the repository's own filters standing. See
`docs/isolation-harness.md`.

**Every new tenant-owned table needs a policy.** Forgetting is a real risk, so
`tests/isolation/rls-coverage.test.ts` cross-checks the live database against
`src/db/tenant-tables.ts` in both directions and fails CI on a table that has a
`tenant_id` column but no policy.

**Cost accepted.** The policy predicate is evaluated per row. On the query
shapes here (indexed lookups within one tenant) the overhead is not measurable
against network time.

## Alternatives considered

**Application layer only** was rejected: it is one forgotten clause away from a
breach across legal entities, which is precisely the failure mode the PRD names
as fatal to the product.

**RLS later, in week 3** (the PRD's own N1 option) was rejected for the reason
the PRD itself gives: retrofitting policies onto queries written without them
means auditing every query already shipped. Day one is strictly cheaper.
