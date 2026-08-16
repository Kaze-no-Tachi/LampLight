# 4. Single VPS, Docker Compose, and Cloudflare Tunnel

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** PRD v0.2 open question B2, sections 5.2 and 5.3
- **Supersedes:** nothing. Preserves ADR 0002 intact, which is part of why it
  was chosen.

## Context

B2 asked whether to host on Vercel plus Neon or on a single VPS with Docker.
The PRD marks it blocking before week 5 because the Cloudflare for SaaS origin
configuration depends on the answer.

Two constraints turned out to decide it, and neither was obvious from the PRD.

**Cloudflare presents the tenant's hostname in the TLS SNI.** For a fallback
origin, Cloudflare sends the custom hostname as both the `Host` header and the
SNI. Any publicly listening reverse proxy is therefore asked to present a
certificate for `institute.edu`. It cannot get one: the tenant's DNS points at
Cloudflare, so no ACME challenge can complete. The official remedy, SNI
rewrite, is gated behind an entitlement that is not available on ordinary
plans. Every public-origin design has to work around this, by dropping to
Cloudflare's non-strict `Full` mode and re-adding authentication with
Authenticated Origin Pulls plus an IP allowlist.

**Managed Postgres cannot express the isolation model in ADR 0002.**
`FORCE ROW LEVEL SECURITY` makes even the table owner subject to policy, so the
superadmin path depends on a role holding `BYPASSRLS`. Granting `BYPASSRLS`
requires superuser, and managed providers do not give you one. On managed
Postgres the superadmin client, the seed script, and the `app-layer-only`
isolation mode would all silently return zero rows, and ADR 0002 would have had
to be rewritten around a weaker mechanism.

## Decision

A single VPS running Docker, with:

- **Docker Compose**, not Swarm, as the orchestrator.
- **Postgres in a container on the same box**, not managed.
- **Cloudflare Tunnel** as the origin connector, not a public listener.
- **Dokploy** as the control plane for deploys and backups.

### Why Compose rather than Swarm

Swarm has been in maintenance for years, and putting a solo-maintained
product's production path on an effectively frozen orchestrator is a liability
that buys little on one node. More concretely, `docker stack deploy` ignores
`build`, `depends_on` conditions, and `profiles`. This repository uses all
three, and PRD goal 5 requires a working `docker compose up` for self-hosters
regardless. Swarm would mean two descriptors drifting apart, with the
production one exercised rarely and the self-host one never tested against
production reality.

Note the wrinkle: **Dokploy initialises Swarm on the host for its own control
plane.** That is acceptable, because Dokploy's "Docker Compose" service type
runs plain `docker compose` rather than `docker stack`. The application stack
stays Compose and the self-host file remains the single source of truth. The
service must be created as Compose, not Stack.

### Why Tunnel rather than a public origin

A tunnel removes the SNI problem instead of working around it. With no inbound
TLS listener there is no certificate to present, so the entire question
disappears rather than being mitigated. It also means the box opens no inbound
ports beyond SSH and never publishes its IP, which is worth real money on a
server holding student records and order history for several institutions.

The cost is a dependency on `cloudflared` staying up, and Cloudflare for SaaS
is already an unavoidable dependency for custom hostnames, so this adds a
failure mode to a vendor already in the critical path rather than a new one.

### Why Postgres on the box

It preserves ADR 0002 exactly. Owning the machine means owning the superuser,
so the two-role split and `FORCE ROW LEVEL SECURITY` work as built, with no
migration changes and no policy rewrite. It also makes the database a localhost
hop rather than a network round trip, which matters for a page that issues
several queries per render.

## Consequences

**The box is a single point of failure for every institute on it.** Acceptable
at two design partners. Worth revisiting somewhere around ten. The compose
split keeps the application stateless, so the escape route is moving Postgres
off the box and adding a second app node, not rewriting anything.

**Backups become our problem, and this is the real cost of the decision.**
Dokploy schedules `pg_dump` to R2 and restores from its UI, which covers the
mechanism. Three things it does not cover, all of which belong in the runbook:

- `pg_dump` is a logical snapshot, so nightly dumps mean a loss window of up to
  a day. Enrollment and order records across several legal entities deserve
  better than that. Add WAL archiving, or dump more often, before design
  partners load real students.
- Dokploy only guarantees restores of backups its own system produced.
- A backup that has never been restored is not a backup. The restore drill is a
  release blocker, not a nice-to-have.

**Dokploy sits in the critical path of deploys and restores** while being a
young project, and it runs as root with access to the Docker socket on a box
holding multi-tenant PII. Two obligations follow: its dashboard is never
exposed publicly, and the runbook carries a manual path for every operation
that does not depend on it.

**The three compose files can drift.** CI parses all of them on every push,
which catches syntax and interpolation errors but not semantic drift. Reviewing
a change to one means checking whether the other two need it.

## Alternatives considered

**Vercel plus Neon**, the other half of B2. Rejected on the ADR 0002 collision
above, which would have forced a weaker isolation mechanism at exactly the
point where the PRD says the product lives or dies. Vercel also bills by
invocation in a way that is hard to predict for audio streaming, though that
was not the deciding factor.

**Public origin with Authenticated Origin Pulls.** Workable: proxied A record
to the VPS, Caddy answering arbitrary SNI with an internal certificate,
Cloudflare in `Full` mode, and AOP plus a Cloudflare IP allowlist restoring the
authentication that non-strict mode gives up. Rejected because it is three
mitigations reconstructing a property the tunnel provides for free, and because
each one is a thing that can be silently misconfigured. The published origin IP
is a permanent liability that the tunnel simply does not have.

**Managed Postgres with the policy rewritten** to grant bypass through
`pg_has_role` on a dedicated role rather than the `BYPASSRLS` attribute. This
genuinely works, needs no superuser, and is provider-agnostic. Rejected because
it changes the security posture recorded in ADR 0002 in exchange for
outsourcing backups, and backups are a solvable problem while a rewritten
isolation model is a permanently larger surface to reason about. Worth
revisiting if the box ever stops being enough.
