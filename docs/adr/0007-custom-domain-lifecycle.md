# 0007. Custom domain lifecycle

Date: 2026-08-16

Status: Accepted

## Context

PRD section 5.3 and requirement P0-4: an institute enters `institute.edu`, sees
the exact DNS records to create, and the domain flips to verified once those
records propagate. Cloudflare for SaaS issues and renews the certificate, and
this application never touches one.

The API call is the easy part. What needed deciding is everything around it.

## Decision

**A claim is not exclusive. A verified domain is.** The `hostname` column was
unique platform-wide, which made typing a name exclusive from that moment. Any
institute could enter a competitor's domain and permanently block them from
attaching it, owning nothing and proving nothing. Uniqueness now applies only
to rows whose status is active. Several institutes may hold a pending claim on
one name; whichever proves ownership through DNS gets it, and after that nobody
else can. See ADR 0001 for the narrowed exception.

**Nothing at or under the platform apex is claimable.** Resolution prefers a
verified custom domain over parsing a subdomain slug, so an institute allowed
to claim `other.lamplight.school` would serve its own site at another
institute's address, and claiming the bare apex would take the marketing site
and the superadmin console. Refused in `claimableHostname`, one pure function,
rather than in whichever form happens to be the way in.

**Ownership is proven by TXT, not by HTTP.** HTTP validation needs the hostname
already pointing at us. It does not, and the institute's existing site has to
keep serving until they choose to move the CNAME. TXT proves ownership before
any traffic moves, so an institute can set the whole thing up and cut over when
they are ready.

**A hostname is live only when the certificate is too.** Cloudflare reports the
custom hostname and its certificate separately. Treating hostname status alone
as done marks a domain verified in our database while Cloudflare is still
issuing, so visitors get a TLS error on a domain we say is fine.

**Cloudflare being unreachable is not the domain failing.** A timeout leaves
the row as it was. Recording it as a failure tells an institute their DNS is
wrong when the only thing wrong is our side of the connection.

**Claims expire after fourteen days and are released at Cloudflare.** Our table
stopped making a claim exclusive, but Cloudflare's custom hostname record still
is: one name, one record. An abandoned claim therefore keeps occupying the name
where it counts, and the institute that actually owns the domain is told it is
"already managed elsewhere" with no way to find out by whom.

**Status refreshes on view, and a sweep covers the rest.** An admin opening the
settings page is the moment somebody is waiting on the answer, so a page load
is worth an API call, and active domains are skipped so a settled institute
costs nothing. A cron-triggered endpoint covers the case where nobody is
watching, because a domain that verifies overnight should be live in the
morning.

**The sweep is cross-tenant without being unscoped.** It lists tenant ids from
the global `tenants` table and then does per-institute work through an ordinary
tenant scope, so every read and write is subject to the same row-level security
as a request. Cross-tenant work does not have to mean reaching for the
RLS-bypassing client.

## Consequences

**The canonical redirect is 302, not the 301 the PRD specifies.** This is the
one place the PRD is wrong once you hit real code.

With two domains X and Y where X is primary, Y redirects to X and browsers
cache that permanently. When the admin later makes Y primary, X starts
redirecting to Y, and every browser holding the cached Y-to-X redirect is now
in a loop that the institute cannot clear and cannot even see, because it works
fine for anybody who never visited before the change. A 301 is only correct for
a mapping that will never change, and "which of my domains is primary" is a
setting with a button next to it.

The cost is a redirect that is not cached, which is a rounding error next to an
institute's site becoming unreachable for its existing visitors.

**The redirect preserves path and query.** Activation and password reset links
are issued on whichever host the person was using, and an institute can change
its primary the next day. A redirect that dropped the query string would turn
every outstanding link into a dead end.

**The redirect lives in the tenant layout, not middleware.** Knowing which
domain is primary is a database question, and middleware runs on the Edge
runtime, which cannot reach Postgres.

**API routes are not redirected**, because they sit outside the tenant route
group. That is the behaviour we want: a form posting to the host it was served
from must keep working during a cutover.

**Nothing yet reconciles a domain that Cloudflare later drops.** The sweep
re-reads pending domains; an active one that stops working at Cloudflare is
noticed only when somebody looks. Worth a periodic re-check of active domains
once there are enough of them to matter.

## Alternatives considered

**Keep the platform-wide unique and police squatting manually.** Rejected: it
makes every contested domain a support ticket, and the platform cannot tell a
squatter from an institute whose DNS change is slow.

**A background worker instead of a cron-hit endpoint.** Rejected for now. The
stack is one VPS running Docker Compose (ADR 0004), and a job runner would be
the largest new moving part in the deployment for a single periodic task. Cron
hitting a URL is something an operator can run by hand and reason about when it
breaks.

**Verify ownership ourselves with a DNS lookup.** Rejected: Cloudflare has to
be satisfied regardless, because it is the party issuing the certificate.
Checking separately means two sources of truth that can disagree, and ours
would be the one nobody trusts.
