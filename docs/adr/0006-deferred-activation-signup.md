# 0006. Signup creates an invitation, not an account

Date: 2026-08-16

Status: Accepted

## Context

Identity is global (ADR 0003) and addresses are unique across the whole
platform. PRD requirement P0-5 says signup must not reveal whether an address
already holds an account, because on a platform of bible institutes that fact
is a roster: submit a list of addresses and learn which of a competitor's
students study online.

The first attempt made the response uniform. Same status, same body, no cookie,
whether the address was new or not. That is necessary and it is not enough. An
attacker could sign up with a password of their choosing and then try to sign
in with it. Success meant the address was new, failure meant it was taken. The
difference was genuinely there, so no amount of shaping the response could
remove it, and the feature shipped disabled instead.

## Decision

Signup creates nothing. It writes a tenant-scoped `signup_invitations` row and
mails a link to the address. The account, the credential, and the membership
all come into being at `/activate`, when somebody follows that link.

Everything follows from that one change.

**Both branches do the same work and answer the same bytes.** New address,
registered address, institute with signup closed, platform switch off, and a
submission suppressed by the resend cooldown are one response. Only shape
errors answer differently, because a malformed address says nothing about who
holds an account.

**Which message goes out depends on the address, and only its owner sees it.**
A new address gets a link that sets a password. A registered one gets a
different message telling its owner their address was used, that nothing
changed, and that signing in will join them to the institute. That is
information the mailbox holder is entitled to and the form filler never learns.

**Activation is verification.** Following a link sent only to that address is
the claim email verification makes, so activation sets `email_verified` and
sign-in requires it. Both halves ship together or the hole reopens.

**Tokens are 32 random bytes, stored as a SHA-256 hash, single use, and expire
in 72 hours.** Uniqueness is scoped per tenant rather than platform-wide,
because the link is always followed on the institute's own hostname, which
resolves the tenant before the token is read. That also lets one address hold
pending invitations at several institutes without either seeing the other's.

**Provisioning an institute uses the same path with role 'admin'.** One way an
account comes into being, one place the rules about single use and expiry are
written, and an operator who never sees a credential.

**Two gates, and they are not interchangeable.** `SELF_SERVE_SIGNUP` is a
platform kill switch, now defaulting to true. `tenant_settings.signup_mode`
is the institute's own decision and defaults to closed. Signup happens only
when both agree, so an operator can stop everything at once without editing any
institute's settings, and restoring the switch restores each institute's choice
rather than a blanket one.

## Consequences

**Mail delivery is load bearing.** A dropped message is not a missing
notification, it is an account nobody can finish creating. Production refuses to
start without a transport configured, in self-host mode as well as platform
mode.

**Signup is a way to make the institute send somebody a message.** Anyone can
type an address they do not own. A pending invitation therefore suppresses
another for fifteen minutes, silently, since saying a request was suppressed
would reveal that one is outstanding. That bounds the nuisance without a
CAPTCHA. It does not eliminate it, and an institute under a determined flood
would want rate limiting at the edge, which Cloudflare already provides.

**A pending invitation is a live credential sitting in a mailbox.** Issuing a
new one deletes any older pending row for the same address, so there is never
more than one working link per address per institute. Nothing yet sweeps rows
that expire unused; they stop working on schedule, but they accumulate.

**The activation route has a resume branch, and it is deliberate.** If the
process dies between creating the account and writing the membership, the
address ends up holding an unverified account with a pending invitation. That
person could otherwise never get in: they cannot sign in, because verification
is required, and they cannot activate, because the account exists. The branch
completes the activation with no password and no session, which grants nothing
that the ordinary path would not have granted a moment earlier.

**An established account is never handed over.** Holding a link to an address
that already has a verified account gets a request to sign in, not a password
prompt. The person who owns the mailbox can sign in and follow the link again.

## Alternatives considered

**Keep signup creating accounts and rate limit the sign-in probe.** Rejected:
rate limiting raises the cost of running the oracle without removing it, and
the property is a P0 rather than a nuisance to be priced.

**Ask for a password at signup and hold it until confirmation.** Rejected: it
means storing a credential for an address nobody has proven control of, and a
person who never confirms leaves a password hash behind for an account that
does not exist.

**Verify by emailing a code rather than a link.** Equivalent on security and
worse on effort for the person, who has to leave the page, copy a code, and
come back. The link carries the tenant host, which the code would have to
resolve some other way.

## Addendum: password reset, and where links come from

Reset has the same shape as everything else here and one extra problem.

The shape: the request endpoint answers identically whether the address holds an
account, a pending request suppresses another for five minutes so the form
cannot be used to mail somebody repeatedly, and the completion page reports one
failure message for a token that was never valid, has been used, or has
expired.

The extra problem is the link. Better Auth builds reset URLs against a single
configured base URL, which cannot be right for a platform where every institute
has its own hostname, and a reset link on the wrong institute's domain invites
somebody to type their password somewhere they have no relationship with. The
library hands the raw token to the callback, so the link can be built
correctly, but it passes no request, so the callback has no host.

Resolved with `AsyncLocalStorage` (`src/lib/auth/sending-institute.ts`). The
route establishes the institute, the callback reads it back, and links are
built on the host the request actually arrived on. A module-level variable
would have been simpler and would race the moment two institutes request a
reset at the same second, sending one institute's user to the other's domain.
That case is asserted directly in `tests/isolation/password-reset.test.ts`
rather than reasoned about.

Reset does not verify an address. Following the link proves control of the
mailbox, so it could, but treating it as verification would let a reset stand
in for activation and quietly become a second way into the platform. The one
state this leaves unrecoverable by the person themselves is an account that was
created but never activated whose invitation has also expired, which needs an
institute admin to invite them again. That is a support action rather than a
lockout, and the resume branch on activation already handles the common form of
it.
