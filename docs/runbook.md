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

4 GB of RAM is the floor and 8 GB is the comfortable choice, because Dokploy is
not only a control panel: it runs its own Postgres, Redis, and Traefik
alongside the stack, which is roughly 1 to 1.5 GB before any Lamplight
container starts. Two cores rather than one, so a backup or a migration is not
competing with request rendering for the only one.

Hostinger ships a Dokploy template, which saves the install step.

```bash
# If not using a template:
curl -sSL https://dokploy.com/install.sh | sh
```

**Nothing but SSH may be reachable from the internet.** Cloudflare reaches the
application through an outbound tunnel, so the origin needs no inbound surface
at all. If you find yourself opening 80 or 443, something is wrong with the
tunnel and the fix is the tunnel, not the firewall.

That is load bearing beyond the obvious. Sign-in rate limiting keys on the
client address, which the application reads from the `CF-Connecting-IP` header,
because behind the tunnel every request otherwise appears to come from the
connector and one bucket would cover the whole platform. Cloudflare overwrites
that header on the way through, so the value can be trusted exactly as long as
nothing can reach the application without passing Cloudflare. Expose the origin
directly and that header becomes attacker controlled, which makes the sign-in
rate limit bypassable by setting it.

#### ufw alone does not do this, and it will tell you it did

Dokploy publishes ports: Traefik on 80 and 443, its own dashboard on 3000.
Lamplight's own stack publishes nothing (see the header of
`docker-compose.prod.yml`), so every publicly bound port on this box belongs to
Dokploy.

A published container port bypasses ufw. Docker DNATs the traffic in the `nat`
table and it is then evaluated in `FORWARD`, while ufw's rules govern `INPUT`.
So `ufw status` will report 443 as denied while 443 is answering the internet.
This is the default behaviour of Docker and ufw together, not a
misconfiguration you can spot by reading either one.

Set up the host firewall anyway, for anything running outside Docker:

```bash
ufw default deny incoming
ufw allow 22/tcp
ufw enable
```

Then close the container ports in `DOCKER-USER`, which is the one chain Docker
leaves to you and traverses first:

```bash
IFACE=$(ip route get 1.1.1.1 | grep -oP 'dev \K\S+')    # usually eth0

# Order matters. Return traffic for connections a container opened outward has
# to survive, or the app cannot reach Cloudflare, Stripe, R2, or SMTP.
iptables -I DOCKER-USER 1 -i "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -I DOCKER-USER 2 -i "$IFACE" -j DROP

# Same again for v6 if the VPS has an address on it.
ip6tables -I DOCKER-USER 1 -i "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
ip6tables -I DOCKER-USER 2 -i "$IFACE" -j DROP
```

**These do not survive a reboot on their own.** Persist them, or the box
quietly reopens the first time it restarts, which is the worst possible time to
find out:

```bash
apt-get install -y iptables-persistent      # prompts to save the current rules
netfilter-persistent save                   # after any later change
```

One consequence worth knowing: with 80 and 443 shut, Dokploy cannot issue its
own Let's Encrypt certificates. That is fine here. Every certificate this
platform serves comes from Cloudflare, both for `lamplight.school` and for
institutes' custom domains (section 4b).

#### Verifying it, properly

Neither of the obvious checks is proof:

- `ufw status` is answering about a chain this traffic never reaches.
- `ss -tlnp` reports that a listener exists, which stays true after the
  `DOCKER-USER` rules take effect. It tells you what is bound, not what is
  reachable.

The only real check is from somewhere else. From your own machine, not the VPS:

```bash
for port in 80 443 3000; do
  nc -z -w 5 <vps-ip> "$port" && echo "REACHABLE: $port" || echo "closed: $port"
done
```

All three must read `closed`. Port 22 should be reachable, which also confirms
the probe itself works and you are not reading a network that drops everything.

Re-run it after upgrading Dokploy and after any reboot. An upgrade recreates
Traefik and the dashboard service, and a reboot starts with an empty ruleset
unless the rules were persisted, so both are ways this box can quietly reopen
without anybody having touched the firewall.

### 1.2 The Dokploy dashboard

Dokploy runs as root with the Docker socket, on a box holding student records
for several institutions. Do not expose its dashboard on a public hostname.
Route it through the tunnel, behind Cloudflare Access with your own email as
the only allowed identity.

**Sequencing trap.** Dokploy's first-run screen creates the admin account, and
whoever reaches it first gets it. Closing port 3000 before you have created
that account locks you out of the setup; leaving it open until the tunnel is
ready leaves an unclaimed root-equivalent dashboard on a public IP, however
briefly. Do neither. Close the ports first as above, then reach the dashboard
over SSH from your own machine:

```bash
ssh -L 3000:localhost:3000 root@<vps-ip>
# then open http://localhost:3000 in your browser and create the account
```

Set up Cloudflare Access on the dashboard's hostname before you route it
through the tunnel, not after.

### 1.3 The tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create lamplight-production      # prints a UUID

# 65532 is the non-root user the cloudflared image runs as. Confirm with
#   docker inspect cloudflare/cloudflared:latest --format '{{.Config.User}}'
install -D -m 600 -o 65532 -g 65532 \
  ~/.cloudflared/<UUID>.json /srv/lamplight/cloudflared/tunnel.json
```

**The owner matters as much as the mode, and getting it wrong fails in a
confusing place.** This file used to be installed as root, mode 600, which
looks careful and leaves the container unable to read its own credential. The
container log then repeats `permission denied` while the site answers
Cloudflare error 1033, which reads like a tunnel that was never created rather
than a file the tunnel cannot open. Keep 600 and change the owner: the answer
is not `chmod 644`, since this credential grants control of the tunnel.

Put the UUID into `docker/cloudflared/config.yml` in place of
`REPLACE_WITH_TUNNEL_UUID`.

Then, in the platform Cloudflare zone, run:

```bash
CLOUDFLARE_ZONE_ID=... CLOUDFLARE_API_TOKEN=... \
CLOUDFLARE_SAAS_FALLBACK_ORIGIN=origin.<apex> \
pnpm cf:setup --target <UUID>.cfargotunnel.com
```

With a real `--target` that ensures four things:

| What                 | Record                                                  | Why                                                    |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Fallback origin      | `origin.<apex>` CNAME to the tunnel, proxied            | Where Cloudflare sends every institute's custom domain |
| Zone setting         | Custom Hostnames fallback origin set to `origin.<apex>` | Custom hostnames do not resolve without it             |
| Platform apex        | `<apex>` CNAME to the tunnel, proxied                   | The platform home page                                 |
| Institute subdomains | `*.<apex>` CNAME to the tunnel, proxied                 | `grace.<apex>` and every institute after it            |

The last two used to be missing, from the script and from this page, which
produced a deployment that worked for institutes who had brought their own
domain and for nobody else. The wildcard is what makes onboarding an institute
a database write rather than a DNS change.

Run it with `--dry-run` first and read the plan. It only ever touches address
records, so MX, TXT, and anything else sharing a name are left alone, and it
refuses rather than guessing if a name already has more than one address
record. Pass `--skip-platform-dns` if the apex is managed somewhere else.

It is idempotent, so re-run it to move the origin later. The token needs
Zone → SSL and Certificates → Edit, Zone → DNS → Edit, and Zone → Zone → Read,
on this zone only.

Omit `--target` and it uses `192.0.2.1`, which is reserved for documentation
and routes nowhere. That is the right placeholder before a tunnel exists: the
record has to be present and orange-clouded before Cloudflare will accept it as
a fallback origin.

To do it by hand instead:

1. Create a CNAME: `origin.<apex>` to `<UUID>.cfargotunnel.com`.
2. **Set it to proxied (orange cloud).** A DNS-only record here produces
   Cloudflare error 1016 and the failure gives no useful clue. This is the
   single most common way to get this setup wrong.
3. SSL/TLS to Custom Hostnames, set `origin.<apex>` as the fallback origin, and
   wait for its status to read Active.

**Checking the whole path works:** `pnpm cf:probe <a-hostname-you-control>`
creates a custom hostname, polls until Cloudflare issues the certificate
validation record, prints every DNS record an institute would be shown, and
deletes it again. It goes through the same client the application uses, so a
green run is evidence about the application rather than about curl.

### 1.4 The application

Create a Dokploy service of type **Docker Compose**, not Stack. Stack deploys
through Swarm and silently drops `profiles`, which is what keeps migrations
from running on every container start.

- Compose file: `docker-compose.prod.yml`
- Environment: everything in the deployment section of `.env.example`. Secrets
  live in Dokploy's environment store, never in the repository.
- Pre-deploy command: see [section 2](#2-deploy).

Generate the two database passwords, the auth secret, and the sweep secret with
`openssl rand -base64 32`. They differ from each other and from every other
environment.

**Check the environment before deploying it**, on a machine with the repository
checked out:

```bash
pnpm env:check /path/to/production.env
```

It runs the same schema and the same production assertions the application runs
at boot, in a process holding only that file's variables, and tells you which
variable is wrong. The alternative is finding out from a container that will
not stay up while you are mid-deploy. It also flags values that look like they
were copied from a development environment, and warns when
`DOMAIN_SWEEP_SECRET` is unset.

**`INSECURE_HTTP` must never appear in this file.** It drops the Secure
attribute from the session cookie, so the cookie travels in the clear and
anyone able to observe the connection can take a session. It exists for one
situation, a browser speaking plain http to a production build, which is how
the browser suite runs and how a developer might poke at `pnpm start` locally.
`pnpm env:check` warns when it is set, and the application logs a warning on
every boot in production. Neither is a substitute for it not being there.

### 1.5 The first platform operator

A fresh deployment has no operator, and nothing in the product can create one.
Signup belongs to an institute and produces an invitation rather than an
account; provisioning an institute is itself a superadmin action; and the seed
that does create an operator also invents two fictional institutes, so it must
never be pointed at a real database. Left alone, a correctly deployed platform
locks out the person who deployed it, and the console answers 404 because that
is what it answers everybody.

Once, after migrations:

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm \
  -e BOOTSTRAP_PASSWORD='<a password you choose, 12 or more>' \
  migrate node_modules/.bin/tsx src/db/bootstrap-admin.ts you@example.com "Your Name"
```

Omit `BOOTSTRAP_PASSWORD` and it generates one and prints it once.

The account is created through the same Better Auth call the activation route
uses, so the password hashes the way sign-in verifies it. Building the row with
an INSERT and a hash of your own produces an account that exists and cannot
sign in. The address is marked verified in the same step, because sign-in
refuses an unverified one and the usual proof is a mailed link belonging to an
institute's hostname, which has no meaning at the apex.

**It refuses if any platform admin already exists**, and that refusal is the
point. On a live platform this would otherwise be a way to quietly grant
somebody the keys to every institute. Promoting a second operator later is a
deliberate INSERT into `platform_admins`, not a rerun.

An address that already holds an account keeps its password: the script grants
standing, it does not seize an identity by naming it. Same rule provisioning an
institute follows.

Then sign in at the apex and provision the first institute (section 4a).

---

## 2. Deploy

Pushing to `main` runs CI. If verify passes, two images are published to GHCR
(the application and the migrator), then Dokploy is pinged.

**Migrations run before the application rolls, as a separate step.** Set this
as the Dokploy pre-deploy command:

```bash
docker compose -f docker-compose.prod.yml pull && \
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

**The `pull` is not redundant, and leaving it out is why a deploy can appear
to succeed while serving the previous release.** Dokploy redeploys by bringing
the stack up again, and `docker compose up` does not re-fetch a tag it already
has locally. `:latest` moves in the registry, the local `:latest` does not, and
containers are recreated from the old image with no error anywhere. Pulling
first also means the migrator that runs is the one belonging to the release
about to start, rather than the one from last time.

**In Dokploy, `--pull always` belongs in Run Command**, which is the cleaner
half of the same fix. Under the service's Advanced settings, override the
default with:

```
docker compose -p <dokploy-project-name> -f ./docker-compose.prod.yml \
  up -d --pull always --remove-orphans --wait
```

`--wait` blocks until healthchecks pass, so a broken release fails the deploy
instead of reporting success over a down site. `--build` is dropped from
Dokploy's default because this compose file builds nothing: images come from
CI, which is what keeps a small box viable.

**Never change the `-p` project name.** It is how Docker finds the existing
containers and the Postgres volume. A different one silently starts a second
stack with an empty database beside the real one.

The same applies to the pre-deploy command, which needs the project name for a
sharper reason: `migrate` declares `depends_on: postgres`, so under a different
project name compose starts its own Postgres, migrates that, and leaves the
real database untouched while reporting success.

Once first light is behind you, prefer pinning `LAMPLIGHT_IMAGE` and
`LAMPLIGHT_MIGRATOR_IMAGE` to a commit sha instead. A tag that never moves
cannot be stale, the deployed version is legible from the environment, and
rolling back is editing one variable rather than working out what `:latest`
meant an hour ago.

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

Take one:

```bash
DATABASE_ADMIN_URL=... scripts/backup.sh /srv/lamplight/backups
```

It dumps in custom format, checks the result can be read back with
`pg_restore --list` before calling it a backup, prints the size and object
count, and prunes anything older than `BACKUP_RETAIN_DAYS` (14 by default).
Pruning happens last, so a failed backup never deletes a good one.

It uses `DATABASE_ADMIN_URL` deliberately. The application role cannot bypass
row-level security, so a dump taken as that role would contain only the rows
visible under whatever `app.tenant_id` was set, which is none of them. That
backup would restore into an empty database and look like it worked.

### The restore drill, which is not optional

Dokploy only guarantees restores of backups its own system produced, and there
is an open issue about large restores executing more than once. A backup you
have never restored is a guess.

The drill restores into a scratch database, so it is safe to run against
production data on an ordinary Tuesday:

```bash
DATABASE_ADMIN_URL=... scripts/restore.sh /srv/lamplight/backups/lamplight-....dump
```

It refuses to restore over the live database unless you add `--i-mean-it`,
checks that `lamplight_app` and `lamplight_admin` exist first (a dump carries a
database, not a cluster's roles, and without them every GRANT and every RLS
policy in it fails), then prints row counts and, most importantly:

```
row-level security: 18 isolation policies, 18 tables forcing it
```

That last line is the one worth reading. A restore that brought the data and
dropped the policies produces a database that looks complete and enforces
nothing, and it exits non-zero rather than letting you believe it.

Run it before go-live and after any change to the backup configuration. Record
how long it took: that number is your actual recovery time, and it is the only
honest input to what you promise an institute.

To take over from a drill and go live on restored data, add `--i-mean-it`.
Afterwards, run `pnpm test:isolation` against it: the suite asserts known
fixture shapes and catches a restore that silently truncated.

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

**Forgotten passwords are self-serve on every institute**, at
`/reset-password` on the institute's own hostname, and need no operator. The
link expires in an hour and is good once. It does not confirm an address, so
somebody who never activated their account cannot use it to get in; if their
invitation has also expired, an institute admin has to invite them again.

**Self-serve signup is off per institute, not per platform.**
`tenant_settings.signup_mode` defaults to `closed` and is the gate that
matters. `SELF_SERVE_SIGNUP` is a kill switch above it: setting it false stops
every institute at once without touching anybody's settings, and restoring it
restores each institute's own choice. See docs/adr/0006.

---

## 4b. Custom domains

An institute attaches its own domain itself, from Domains in its settings. The
operator is not in the loop and does not need to be: the institute adds the
hostname, creates the two DNS records shown, and the domain goes live once
Cloudflare confirms them.

What the operator owns is the sweep, which is shared with the retention job
below. See [section 4c](#4c-the-maintenance-sweep).

Without it, a domain that verifies overnight goes live when an admin next opens
the settings page rather than in the morning. That is a delay, not an outage,
so a failed sweep is not a page-in-the-night event.

The endpoint 404s when `DOMAIN_SWEEP_SECRET` is unset, and 404s on a wrong
secret too, so a 404 here means one of the two and the logs say which.

**When an institute says their domain is not working:**

| Symptom                                     | Where to look                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stuck on "Checking DNS"                     | Their records are not published yet, or not exactly as shown. The settings page prints Cloudflare's own reason under the domain.                                                   |
| "Already managed elsewhere"                 | Another Cloudflare account holds that custom hostname. If it is theirs, they remove it there first. If it is an abandoned claim of ours, the sweep clears it within fourteen days. |
| Live but visitors get a certificate warning | The hostname went active before the certificate did. This should be impossible (both are required), so check the sweep is running and the domain's status in the database.         |
| Redirect loop between two of their domains  | Should not happen: the canonical redirect is 302 precisely so it is never cached. If it does, look for a proxy or CDN in front of us caching it anyway.                            |

---

## 4c. The maintenance sweep

It runs itself. `docker-compose.prod.yml` has a `sweep` service that calls the
endpoint every `SWEEP_INTERVAL_SECONDS` (900 by default) from inside the
compose network, so it is deployed and versioned with everything else instead
of living in somebody's crontab.

Nothing called this endpoint until that service existed. On a deployment
without it, a custom domain sits unverified until an admin happens to open the
settings page, and expired invitations are never deleted.

Both the app and the sweep service need `DOMAIN_SWEEP_SECRET`, and it must be
the same value. Watch it work:

```bash
docker compose -f docker-compose.prod.yml logs -f sweep
```

The service refuses to start when the secret is unset, rather than looping
against an endpoint that answers 404 and looking healthy while doing nothing.

To run one by hand:

```bash
curl -fsS -X POST \
  -H "x-lamplight-sweep-secret: $DOMAIN_SWEEP_SECRET" \
  https://<apex>/api/platform/sweep
```

**Domains.** Polls Cloudflare for every unverified hostname and releases claims
that lapsed. Skipped entirely when Cloudflare is not configured.

**Invitations.** Deletes expired unconsumed invitations, and consumed ones
older than ninety days. This runs whether or not Cloudflare is configured,
including on a self-hosted instance, because retention should not depend on an
unrelated integration being set up.

That second job is why the sweep matters on a self-host box too. An expired
unconsumed invitation holds an address, a name, and whatever the institute asks
at signup, belonging to somebody who never became a user. Keeping it because
nothing forced a deletion is the wrong default for a system holding student
records.

The response says what it did, which is the quickest way to tell a sweep that
ran and had nothing to do from one that is not running at all:

```json
{
  "status": "ok",
  "tenants": 2,
  "domains": { "refreshed": 3, "released": 0, "enabled": true },
  "invitations": { "expired": 1, "spent": 0 },
  "failed": 0
}
```

`failed` counts institutes whose sweep threw. One institute's trouble does not
stop the rest, so a non-zero count with a 200 response is a partial run, not a
failure to run.

---

## 5. Rotate secrets

| Secret                    | How                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`      | Rotate in Dokploy, redeploy. Invalidates every session, so every user signs in again. Do it deliberately, not on a Friday.                                                                |
| `POSTGRES_APP_PASSWORD`   | `ALTER ROLE lamplight_app WITH PASSWORD '...'`, update `DATABASE_URL`, redeploy.                                                                                                          |
| `POSTGRES_ADMIN_PASSWORD` | Same for `lamplight_admin` and `DATABASE_ADMIN_URL`.                                                                                                                                      |
| `CLOUDFLARE_API_TOKEN`    | Issue a new scoped token, update, redeploy, then revoke the old one in that order.                                                                                                        |
| `DOMAIN_SWEEP_SECRET`     | Update in Dokploy and in the cron line together. A mismatch is silent: the sweep just 404s and domains stop being polled, which looks like Cloudflare being slow.                         |
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

**Cloudflare 1033 on every hostname, including the apex.** DNS is pointing at a
tunnel that has nothing connected to it. The application being healthy tells
you nothing here, because it is cloudflared that is missing, so go straight to
its log:

```bash
docker compose -f docker-compose.prod.yml logs --tail 40 cloudflared
```

In order of likelihood: the container was never started, because
`up -d --wait app` brings up only the app and its dependencies and cloudflared
depends on the app rather than the reverse; the credentials file is owned by
root and the container runs as 65532, so the log repeats `permission denied`
(see section 1.3); or the deployed `config.yml` still says
`REPLACE_WITH_TUNNEL_UUID` because the clone predates the commit that set it.

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
