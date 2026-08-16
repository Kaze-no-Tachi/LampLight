# Production runbook

The platform runs on one VPS: Docker Compose for the stack, Dokploy as the
control plane, Cloudflare Tunnel as the only way in, Postgres in a container on
the same box. The reasoning is in [ADR 0004](adr/0004-single-vps-docker-compose-hosting.md).

Every procedure here has a manual path that does not depend on Dokploy. If
Dokploy is the only way you know how to do something, you cannot fix the box on
the day Dokploy is what broke.

---

## 1. Provision a new environment

### 1.1 The box

Any VPS with 4 GB of RAM and Docker will do. Hostinger ships a Dokploy
template, which saves the install step.

```bash
# If not using a template:
curl -sSL https://dokploy.com/install.sh | sh
```

Lock it down before anything else goes on it:

```bash
ufw default deny incoming
ufw allow 22/tcp
ufw enable
```

**Port 80 and 443 stay closed.** Cloudflare reaches the application through an
outbound tunnel. If you find yourself opening them, something is wrong with the
tunnel and the fix is the tunnel, not the firewall.

Verify with `ss -tlnp`. SSH and Docker's internal listeners only.

Those closed ports are load bearing beyond the obvious. Rate limiting on
sign-in keys on the client address, which the application reads from the
`CF-Connecting-IP` header, because behind the tunnel every request otherwise
appears to come from the connector and one bucket would cover the whole
platform. Cloudflare overwrites that header on the way through, so the value
can be trusted exactly as long as nothing can reach the application without
passing Cloudflare. Open 443 to the world and that header becomes attacker
controlled and rate limiting becomes bypassable by setting it.

### 1.2 The Dokploy dashboard

Dokploy runs as root with the Docker socket, on a box holding student records
for several institutions. Do not expose its dashboard on a public hostname.
Route it through the same tunnel, behind Cloudflare Access with your own email
as the only allowed identity.

### 1.3 The tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create lamplight-production      # prints a UUID
install -m 600 ~/.cloudflared/<UUID>.json /srv/lamplight/cloudflared/tunnel.json
```

Put the UUID into `docker/cloudflared/config.yml` in place of
`REPLACE_WITH_TUNNEL_UUID`.

Then, in the platform Cloudflare zone:

1. Create a CNAME: `origin.<apex>` to `<UUID>.cfargotunnel.com`.
2. **Set it to proxied (orange cloud).** A DNS-only record here produces
   Cloudflare error 1016 and the failure gives no useful clue. This is the
   single most common way to get this setup wrong.
3. SSL/TLS to Custom Hostnames, set `origin.<apex>` as the fallback origin, and
   wait for its status to read Active.

### 1.4 The application

Create a Dokploy service of type **Docker Compose**, not Stack. Stack deploys
through Swarm and silently drops `profiles`, which is what keeps migrations
from running on every container start.

- Compose file: `docker-compose.prod.yml`
- Environment: everything in the deployment section of `.env.example`. Secrets
  live in Dokploy's environment store, never in the repository.
- Pre-deploy command: see [section 2](#2-deploy).

Generate the two database passwords and the auth secret with
`openssl rand -base64 32`. They differ from each other and from every other
environment.

---

## 2. Deploy

Pushing to `main` runs CI. If verify passes, two images are published to GHCR
(the application and the migrator), then Dokploy is pinged.

**Migrations run before the application rolls, as a separate step.** Set this
as the Dokploy pre-deploy command:

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

This is not a style preference. Migrating from the application entrypoint means
every replica races the migration table on startup, and a rollback means a
container trying to downgrade a schema another container is still serving.

Manual path, if Dokploy is unavailable:

```bash
cd /srv/lamplight
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml up -d --wait
```

`--wait` blocks until healthchecks pass, so the command failing means the
deploy failed. Without it you get a green shell prompt and a broken site.

### Verify a deploy

```bash
docker compose -f docker-compose.prod.yml exec app \
  wget -qO- http://127.0.0.1:3000/api/health
# {"status":"ok","database":"ok"}
```

The probe checks database reachability, not just that the process is alive, so
a 200 here means the app can actually serve.

A 503 names which system failed, and the distinction saves real time during an
outage:

| Response                                          | What it means                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{"status":"unhealthy","reason":"configuration"}` | An environment variable is missing or malformed. Nothing is wrong with Postgres. Which variable is in the container log, not in the response, because this endpoint is public through the tunnel. |
| `{"status":"unhealthy","reason":"database"}`      | Configuration parsed fine and Postgres is genuinely unreachable. Start with `docker compose ps` and the postgres container.                                                                       |

The most common cause of the first one, by some distance, is deploying in
platform mode with the Cloudflare credentials unset. The second most common is
deploying without `SMTP_HOST` and `MAIL_FROM`. Both are refusals to serve
rather than warnings, because an instance that cannot deliver mail cannot let
anybody finish creating an account, and finding that out from a user is worse
than finding it out from a failed deploy.

---

## 3. Roll back

Images are tagged with the commit SHA, so rolling back is pinning the previous
one:

```bash
LAMPLIGHT_IMAGE=ghcr.io/<owner>/lamplight:<previous-sha> \
  docker compose -f docker-compose.prod.yml up -d --wait
```

**Migrations do not roll back.** Drizzle generates forward-only migrations, and
there are no down scripts by design. If a release shipped a destructive schema
change, rolling the image back does not undo it, and you are in section 4
rather than section 3. This is the reason to keep schema changes additive:
add a column, backfill, switch reads, drop the old column in a _later_ release,
so that any single release is safe to roll back.

---

## 4. Backups and restore

### What is at risk

The Postgres volume on this box. Lesson media lives in R2 and is not at risk
from losing the VPS. Losing the volume means losing enrollments, orders, and
progress for every institute at once, which is a multi-party incident, not an
outage.

### Schedule

Dokploy backups, targeting the R2 bucket, at minimum daily. `pg_dump` is a
logical snapshot, so the loss window is the gap between dumps. Daily means up
to 24 hours of enrollments and payments gone. **Before design partners load
real students, either shorten the interval to a few hours or add WAL archiving
for point-in-time recovery.**

Manual dump:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U lamplight_admin -Fc lamplight > lamplight-$(date +%F).dump
```

### The restore drill, which is not optional

Dokploy only guarantees restores of backups its own system produced, and there
is an open issue about large restores executing more than once. A backup you
have never restored is a guess.

Run this before go-live, and again after any change to the backup config:

1. Provision a scratch VPS or a local stack.
2. Restore the most recent production backup into it.
3. Run the isolation suite against the restored data:
   `pnpm test:isolation`. It asserts against known fixture shapes, so it also
   catches a restore that silently truncated.
4. Record how long the whole thing took. That number is your actual recovery
   time, and it is the only honest input to what you promise an institute.

Manual restore:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U lamplight_admin -d lamplight --clean --if-exists < lamplight-2026-08-16.dump
```

---

## 4a. Provisioning an institute

From the superadmin console on the platform apex. It creates the tenant, its
subdomain, and the first admin in one action, and writes an audit_log row.

**A single-use invitation is emailed to the address you name.** The console
does not show it and cannot retrieve it. The link goes from the mail server to
their mailbox, it expires in 72 hours, it works once, and it ends with them
choosing a password you never learn. Provision the same slug again to reissue.

Nothing exists for that person until they follow it: no account, no password,
no membership. So an institute you just provisioned has no members until its
admin clicks through, which is the intended state rather than a failure.

If the address already holds an account, nothing about it changes. The link
asks them to sign in, and signing in is what joins them to the institute.
Provisioning is not a way to seize an existing identity by naming it.

**If no mail arrives**, check the app log for the message and the SMTP settings
before reprovisioning. In development with no SMTP configured the whole message
is written to stderr, link included, which is how the flow is exercised
locally.

**Self-serve signup is off per institute, not per platform.**
`tenant_settings.signup_mode` defaults to `closed` and is the gate that
matters. `SELF_SERVE_SIGNUP` is a kill switch above it: setting it false stops
every institute at once without touching anybody's settings, and restoring it
restores each institute's own choice. See docs/adr/0006.

---

## 5. Rotate secrets

| Secret                    | How                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`      | Rotate in Dokploy, redeploy. Invalidates every session, so every user signs in again. Do it deliberately, not on a Friday.                                                                |
| `POSTGRES_APP_PASSWORD`   | `ALTER ROLE lamplight_app WITH PASSWORD '...'`, update `DATABASE_URL`, redeploy.                                                                                                          |
| `POSTGRES_ADMIN_PASSWORD` | Same for `lamplight_admin` and `DATABASE_ADMIN_URL`.                                                                                                                                      |
| `CLOUDFLARE_API_TOKEN`    | Issue a new scoped token, update, redeploy, then revoke the old one in that order.                                                                                                        |
| `SMTP_PASSWORD`           | Roll at the mail provider, update, redeploy. Verify by provisioning a throwaway institute and confirming the invitation arrives: a broken mailer is silent until somebody cannot sign up. |
| Tunnel credentials        | `cloudflared tunnel create` a replacement, repoint the fallback origin CNAME, delete the old tunnel.                                                                                      |
| `STRIPE_*`                | Roll in the Stripe dashboard. Webhook secrets are per endpoint, so update the endpoint and the variable together or payments go silently unprocessed.                                     |

After rotating either database password, confirm the isolation guarantee is
still intact:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql "$DATABASE_URL" -tAc \
  "select rolsuper or rolbypassrls from pg_roles where rolname = current_user"
# must print: f
```

If that ever prints `t`, the application role can bypass row-level security and
the second isolation layer is gone while every test still passes. CI runs the
same check on every build.

---

## 6. When things break

**Cloudflare 1016 on a tenant domain.** Almost always the fallback origin. Check
that the `origin.<apex>` CNAME is proxied, not DNS-only, and that the custom
hostname shows both `status` and `ssl.status` as active.

**Tenant domain resolves to the wrong institute, or 404s.** Tenant resolution
reads the `Host` header. Confirm it survives the tunnel:

```bash
docker compose -f docker-compose.prod.yml exec app \
  wget -qS --header="Host: institute.edu" -O- http://127.0.0.1:3000/ 2>&1 | head
```

**Deploy went green but the site is down.** You probably deployed without
`--wait`. Check `docker compose ps` for a container sitting unhealthy, then
`docker compose logs app --tail=100`.

**Everything is slow.** Check the Postgres container first: it shares CPU and
disk with the application, which is the known cost of ADR 0004. `docker stats`
and `pg_stat_activity` for long-running queries.
