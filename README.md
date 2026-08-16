# Lamplight

Open source, multi-tenant learning platform for bible institutes.

Institutes sell structured degree programs made of many individual courses, and
sell those same courses standalone. Most platforms treat the course as the
atomic unit and bolt bundles on awkwardly, which leaves institutes granting
access by hand, tracking entitlements in spreadsheets, or paying per-seat
pricing that does not fit a student who buys a four-year program once.

Lamplight treats the entitlement as the thing that matters. Buy a program and you
get every course inside it. Buy one course and you get exactly that. Every
institute runs on its own domain, with its own branding, collecting its own
money through its own Stripe account.

Licensed under AGPL v3. Self-hosting a single institute is a supported
first-class case, not an afterthought.

## Status

Phases 1 and 2 of 9. The data layer and its isolation harness, the deployment
topology, host-based tenant resolution, authentication with per-tenant
memberships, and the superadmin console. **There is no catalog and no
payments yet**, so students cannot buy or play anything. See
[Roadmap](#roadmap).

Two properties are worth stating up front, because they are what the product
is for:

- **A session grants nothing at another institute.** Authentication is
  platform-wide; authorization is a session plus a membership in the tenant
  resolved from the `Host` header. Signed in at one institute, the same session
  gets a 404 at another. Covered by `tests/e2e/tenant-isolation.spec.ts`.
- **Denial never distinguishes.** An unknown host, an unverified domain, a
  suspended institute, a missing page, and a page you may not see all return
  the same 404, so the platform's customer list cannot be enumerated.

## What makes this project unusual

Lamplight holds student PII and payment records for independent legal entities in
one shared database. Cross-tenant data leakage is the failure mode that would
end the product, so isolation is enforced at two layers that fail independently:

**Application.** Every tenant-owned table has a `tenant_id`. Every repository
function takes a `TenantScope` as its first parameter and filters on it. There
is exactly one module that can produce an unscoped database client
(`src/db/admin.ts`), and ESLint blocks importing it anywhere except migration
tooling, superadmin routes, and the isolation harness.

**Database.** Postgres row-level security is enabled and forced on every
tenant-owned table, with policies keyed on the `app.tenant_id` session setting,
set per transaction on checkout. If application scoping is ever forgotten, the
query returns zero rows rather than another institute's students.

Beyond the two layers, the schema makes cross-tenant references structurally
impossible: every foreign key between tenant-owned tables is composite on
`(tenant_id, id)`, so a course cannot point at another institute's product and
an enrollment cannot point at another institute's student. The database rejects
it rather than trusting the code not to try.

The reasoning behind all of this is in [`docs/adr/`](docs/adr/), and the test
strategy is in [`docs/isolation-harness.md`](docs/isolation-harness.md).

## Local setup

Requires Node 20.11 or newer, pnpm, and Docker.

```bash
pnpm install
cp .env.example .env          # defaults match the compose stack
docker compose up -d          # Postgres 16 and Minio
pnpm db:migrate
pnpm db:seed
pnpm test
```

That should finish green with 198 tests passing. Then:

```bash
pnpm dev                      # http://localhost:3000
```

### What compose gives you

| Service             | Where                                          | Credentials                                    |
| ------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Postgres 16         | `localhost:5432`, database `lamplight`         | see `.env.example`                             |
| Minio (R2 stand-in) | API `localhost:9000`, console `localhost:9001` | `lamplight_minio` / `lamplight_minio_password` |

Postgres starts with **two roles**, and the split is load-bearing rather than
tidiness:

- `lamplight_app` is what the application connects as. It is not a superuser and
  does not hold `BYPASSRLS`, so row-level security genuinely constrains it.
- `lamplight_admin` owns the schema, runs migrations, and backs the superadmin
  client. It bypasses RLS.

Collapsing these two into one connection string removes the database isolation
layer with no visible symptom, so `src/env.ts` refuses to boot when
`DATABASE_URL` equals `DATABASE_ADMIN_URL`.

### Seeded data

Two institutes, deliberately built from the same template so every slug,
title, and structure collides. A leak looks like plausible data rather than
obviously foreign data, which is what the isolation suite is built to catch.

|                 | Grace Bible Institute                                       | Cornerstone Baptist Institute                                                   |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Slug            | `grace`                                                     | `cornerstone`                                                                   |
| Domains         | `grace.lamplight.school`, `learn.gracebible.test` (primary) | `cornerstone.lamplight.school` (primary), `learn.cornerstone.test` (unverified) |
| Members         | admin, instructor, 3 students                               | admin, instructor, 3 students                                                   |
| Catalog         | 2 programs, 6 courses, 12 modules, 24 lessons               | same shape                                                                      |
| Application fee | 0 bps (design partner)                                      | 250 bps                                                                         |

`shared.student@example.test` is a member of **both** institutes, which is the
cross-tenant identity case from the PRD and the sharpest test in the suite.

Enrollment shapes present in each institute: a purchased program, a purchased
single course, a manually granted scholarship with an expiry, and one lapsed
enrollment that must read exactly like no enrollment at all.

## Commands

| Command               | What it does                                  |
| --------------------- | --------------------------------------------- |
| `pnpm dev`            | Next.js dev server                            |
| `pnpm build`          | Production build                              |
| `pnpm typecheck`      | `tsc --noEmit`                                |
| `pnpm lint`           | ESLint, including the admin-client import ban |
| `pnpm format`         | Prettier write                                |
| `pnpm test`           | Unit plus isolation suites                    |
| `pnpm test:isolation` | Cross-tenant isolation only                   |
| `pnpm test:e2e`       | Playwright                                    |
| `pnpm db:generate`    | Generate a migration from schema changes      |
| `pnpm db:migrate`     | Apply migrations (as the admin role)          |
| `pnpm db:seed`        | Reset and reseed both institutes              |
| `pnpm db:reset`       | Truncate all application data                 |

## Architecture

Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui. Postgres 16 with
Drizzle. Better Auth. Stripe Checkout plus Connect Standard. Cloudflare R2 for
object storage, Cloudflare for SaaS for custom hostnames. vidstack.dev for
audio. Vitest and Playwright.

```
src/
  db/
    schema/          Drizzle table definitions, grouped by concern
    repositories/    Tenant-scoped reads. TenantScope is always parameter one
    client.ts        getTenantDb(tenantId), the only way feature code queries
    admin.ts         RLS-bypassing client. Import-banned outside a short list
    scope.ts         TenantScope and the tenant-bound handle types
    seed-data.ts     The fixture, shared by the seed script and the tests
    tenant-tables.ts Registry of tenant-owned tables, asserted against the db
  env.ts             Zod-validated config. The app refuses to start if invalid
drizzle/             Checked-in migrations, including the RLS policies
docs/adr/            Architecture decision records
tests/
  isolation/         The suite that blocks merges
  unit/              Fixture invariants
  e2e/               Playwright
```

### Contributing to the data layer

Two rules the CI enforces rather than trusts:

1. **A new read path is registered in `tests/helpers/read-paths.ts` in the same
   commit that adds it.** Export a repository function without registering it
   and CI fails naming the function you forgot.
2. **A new tenant-owned table is added to `src/db/tenant-tables.ts` and given
   an RLS policy in the migration.** Add a table with a `tenant_id` column and
   skip either, and CI fails.

## Deployment

Three stacks, one codebase.

| File                          | For                        | What runs                   |
| ----------------------------- | -------------------------- | --------------------------- |
| `docker-compose.yml`          | Local development          | Postgres, Minio             |
| `docker-compose.prod.yml`     | The hosted platform        | App, Postgres, cloudflared  |
| `docker-compose.selfhost.yml` | One institute, self-hosted | App, Postgres, Minio, Caddy |

### Self-hosting a single institute

```bash
cp .env.example .env     # set SELFHOST_DOMAIN, ACME_EMAIL, and the passwords
docker compose -f docker-compose.selfhost.yml --profile tools run --rm migrate
docker compose -f docker-compose.selfhost.yml up -d
```

Point your domain's DNS at the box. Caddy obtains and renews the certificate
itself, so there is no cron job and nothing to remember. No Cloudflare account,
no Stripe Connect, no platform dependency: `TENANCY_MODE=single` pins one tenant
and skips Host header resolution entirely, and `PAYMENTS_MODE=direct` charges on
your own Stripe account with no application fee.

### The hosted platform

A single VPS running Docker Compose, with Postgres on the same box and
Cloudflare Tunnel as the only way in. Full procedures are in
[`docs/runbook.md`](docs/runbook.md); the reasoning is in
[ADR 0004](docs/adr/0004-single-vps-docker-compose-hosting.md).

Two decisions there are worth knowing before you read the config, because both
look wrong until you know why:

**No inbound ports.** Not 80, not 443. Cloudflare for SaaS sends the tenant's
own hostname as the TLS SNI, so any public listener gets asked for a
certificate for `institute.edu`, which it cannot obtain. A tunnel has no
inbound listener, so the problem does not exist rather than being mitigated.
The box also never publishes its IP.

**Postgres is on the box, not managed.** `FORCE ROW LEVEL SECURITY` means the
superadmin path needs a role holding `BYPASSRLS`, and granting that needs
superuser, which managed providers do not offer. Owning the machine is what
keeps the isolation model in ADR 0002 working as designed rather than needing a
weaker substitute. The trade is that backups are ours: see the restore drill in
the runbook, which is a release blocker.

## Roadmap

Phases 1 and 2 are done. The rest, per the PRD:

3. Custom domains: Cloudflare for SaaS, DNS instructions, verification polling
4. Content model: programs, courses, modules, lessons, R2 uploads, signed URLs
5. Entitlements: the access predicate, bulk catalog variant, manual enrollment
6. Payments: Connect onboarding, Checkout, webhook routing, refund revocation
7. Player: persistent mini-player, progress sync, speed, keyboard shortcuts
8. Theming: token rendering, presets, asset upload, copy editing
9. Self-host and launch: compose, Caddy, docs, design partner onboarding

## License

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).

AGPL means that if you run a modified Lamplight as a network service, you have to
offer your users the source of your modifications. That is deliberate: the
point is that institutes can always leave with their platform intact.
