# 1. Shared schema multi-tenancy

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** PRD v0.2 section 5.1

## Context

Lamplight hosts many independent bible institutes on one deployment. Each holds
student PII and payment records for a separate legal entity. There are three
usual ways to keep them apart:

1. **Database per tenant.** Strongest isolation. Every tenant gets its own
   Postgres database.
2. **Schema per tenant.** One database, one Postgres schema per tenant.
3. **Shared schema.** One database, one set of tables, a `tenant_id` column on
   every tenant-owned row.

The operator is a solo maintainer serving institutes that pay hundreds of
dollars a month, not thousands.

## Decision

Shared schema. Every tenant-owned table carries `tenant_id uuid not null
references tenants(id)`.

Three structural rules follow, and all three are enforced rather than
documented:

- Every tenant-owned table has a unique constraint on `(tenant_id, id)`.
- Every foreign key between two tenant-owned tables is composite on
  `(tenant_id, id)`, so a row physically cannot reference a row belonging to a
  different tenant. A course cannot point at another institute's product; a
  lesson cannot point at another institute's module. This is not a convention,
  it is a constraint the database rejects violations of.
- Natural-key uniqueness is composite with `tenant_id`, so two institutes can
  both have a course at `/courses/old-testament-survey`.

## Consequences

**What this buys.** One migration to write and one to review, rather than one
per tenant. One connection pool. Cross-tenant operator queries (which tenants
have unverified domains, which are approaching a Stripe requirement deadline)
are ordinary SQL rather than a fan-out. Onboarding a tenant is an INSERT, which
is what makes the two-hour onboarding goal reachable.

**What this costs.** Isolation is now a property of the code and the policies
rather than of the storage layout. A single missing `WHERE` clause is a data
breach across legal entities. That risk is the entire reason for ADR 0002.

**The noisy-neighbour risk is accepted.** One institute with a large catalog
shares table space and index pages with everyone else. At the scale in the PRD
(two design partners, tens of institutes) this does not matter. If it ever
does, the exit is partitioning by `tenant_id`, which the composite keys already
set up.

## Exceptions

`tenant_domains.hostname` is unique **platform-wide**, not per tenant. The PRD
says every unique constraint is composite with `tenant_id`, and for this one
column that would be wrong: a hostname resolves to exactly one tenant, so a
per-tenant constraint would let two institutes both claim `institute.edu` and
leave Host-header resolution ambiguous. The constraint is deliberately global
and the code comment on the table says why.

## Alternatives considered

**Database per tenant** was rejected on migration and pooling cost. Hundreds of
databases means hundreds of migration runs to monitor and a connection pool per
database, which a solo maintainer will not keep healthy.

**Schema per tenant** has the same migration fan-out with weaker tooling
support, and Drizzle's migration story assumes a fixed schema. It buys less
isolation than database-per-tenant while costing nearly as much.
