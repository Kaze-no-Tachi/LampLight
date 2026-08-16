# 3. Global identity with per-tenant memberships

- **Status:** Accepted
- **Date:** 2026-08-16
- **Context:** PRD v0.2 sections 5.4 and 6, non-goal "cross-tenant SSO"

## Context

A person can plausibly hold accounts at more than one institute on the
platform: a student at one, a guest lecturer at another. The schema has to
decide whether that is one row or two.

The PRD asks for something that sounds contradictory at first. Section 5.4 says
identities are global with a `memberships` join table carrying the role.
Section 3 lists cross-tenant SSO as a non-goal, and says signup must never
reveal whether an email already exists elsewhere on the platform.

## Decision

One global `users` table keyed on a globally unique email, plus a
tenant-scoped `memberships` table carrying the role.

`memberships` has a unique constraint on `(tenant_id, user_id)`: one membership
per person per institute. That constraint is load-bearing beyond deduplication.
It is the foreign key target that lets `course_instructors`, `enrollments`,
`orders`, and `progress` reference `(tenant_id, user_id)` and thereby require,
at the database level, that the person is a member of the same tenant as the
row. An institute cannot enroll another institute's student, and the database
rejects the attempt rather than trusting the code not to make it.

Global identity does not mean shared sessions. Cookies are domain-scoped, so a
login at `learn.gracebible.test` has no bearing on `cornerstone.lamplight.school`.
Signing in twice is the intended behaviour, not a gap.

## Consequences

**`users` is the one tenant-blind table in the schema, and that is the sharp
edge of this decision.** It has no `tenant_id` and therefore no RLS policy.
Any query that reaches `users` without joining through `memberships` can see
people who belong to other institutes.

Three things contain that:

1. Repositories reach users only through `memberships`, which is RLS-protected.
   The example repositories are written that way deliberately, as the pattern
   to copy.
2. Nothing in `users` is commercially sensitive on its own: email, display
   name, avatar. Enrollments, orders, and progress, which are the sensitive
   records, are all tenant-scoped and policy-protected.
3. `src/db/tenant-tables.ts` lists `users` in `GLOBAL_TABLES` explicitly, so
   the coverage test treats it as a deliberate decision rather than an
   oversight, and a future tenant-owned table cannot land there by accident.

**Signup must not become an account-existence oracle.** Because emails are
globally unique, a naive "email already registered" error on a tenant domain
tells an institute admin that a given person has an account at some other
institute. Signup has to create the user if new, attach a student membership,
and return an identical response either way. That is a phase 2 obligation this
ADR creates, and it is called out in the phase 1 handoff as not yet built.

**Deleting a person is not a single delete.** Removing a user cascades to
memberships across every institute they belong to. Tenant offboarding is
therefore membership removal, not user removal. The PRD leaves offboarding open
as N4, and this narrows it: offboarding is scoped to memberships and
tenant-owned rows.

**A v2 door stays open.** If cross-tenant SSO is ever wanted, the identity
model already supports it and only the session layer changes. Had this shipped
as one user row per tenant, that would be a migration touching every table that
references a user.

## Alternatives considered

**One user row per tenant, scoped email uniqueness.** Simpler isolation story:
`users` becomes tenant-owned and gets a policy like everything else, and the
existence-oracle problem disappears. Rejected because it makes the same person
at two institutes two unrelated rows, which forecloses cross-tenant identity in
v2 without a painful migration, and because it duplicates credentials, so a
password change at one institute silently does not apply at the other.

**Global identity with a shared session.** Rejected: it is the cross-tenant SSO
the PRD explicitly defers, and it carries privacy consequences (one institute
learning which others a person attends) that need a deliberate decision rather
than a default.

## Addendum, 2026-08-16: the obligation collides with the roadmap

The obligation this ADR created, that signup must not reveal cross-tenant
account existence, turns out not to be satisfiable on its own schedule.

Making the response uniform is straightforward and is done. It is not
sufficient. Anyone who can sign up can then try to sign in with the password
they just chose: success means the address was new, failure means it already
existed. The difference is real, so no amount of shaping the response removes
it. The only fix is to activate nothing until a link sent to the address is
followed, which ends both paths at "check your email" and leaves nothing to
test.

That requires mail delivery. The PRD schedules email notifications as P1 and
the property they protect as P0-5. Those cannot both hold, and the conflict is
in the requirements rather than in the implementation.

Resolved by shipping self-serve signup disabled (`SELF_SERVE_SIGNUP`, default
false). The endpoint accepts the request and answers exactly as it does when
enabled, so the setting is not observable from outside, and P0-5 holds today
because there is no working oracle to run. Accounts reach institutes through
superadmin provisioning now, and through Stripe checkout in phase 6.

Enabling it is one environment variable once mail delivery lands, at which
point `requireEmailVerification` should be turned on in the same change. Doing
one without the other reopens exactly this hole.
