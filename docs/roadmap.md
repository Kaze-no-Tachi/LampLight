# Roadmap

Where the project stands and what is left, in the order it should be built.

Written down because the ordering carries reasoning that is easy to lose:
deployment comes before features not because it is more interesting but because
every claim after it is otherwise unverifiable, and payments come last because
nothing else depends on them.

## Where things stand

Shipped and verified against something real, not just tests:

- Two-layer tenant isolation: application scoping plus Postgres RLS, asserted
  in both directions by a registry of every read path
- Host to tenant resolution, canonical domain redirect, generic 404 for
  anything unresolvable
- Auth with per-tenant membership, deferred activation so signup is not an
  account-existence oracle, password reset, role guards
- Custom domains end to end at Cloudflare: claim rules, custom hostname
  creation, DNS records shown to the institute, verification sweep. Proven
  against the live `lamplight.school` zone
- The access predicate, all six branches, and signed media issued only behind it
- Instructor content management, scoped to assigned courses
- Course content: descriptions, syllabus, documents
- Per-tenant theming and copy (P0-12), with a settings screen
- Student profile: enrolled courses, how each arrived, expiry, intake answers
- Superadmin tenant provisioning (P0-13)
- Self-host and production compose stacks, both actually run

Not started: payments (P0-7), the audio player (P0-8), manual enrollment
(P0-11), assessment (deferred by the PRD), and any deployment to a real host.

## Phase 5: get it live

Nothing after this can be trusted until this is done. The app has never run
anywhere but a laptop and a session container, so every statement about
production is inference.

1. A host. A small VPS is enough for the first institutes. Postgres in compose
   alongside the app, or managed, decided on how much the operator wants to own.
2. `cloudflared tunnel create`, then `pnpm cf:setup --target <uuid>.cfargotunnel.com`.
   The tunnel means no inbound ports and no public IP to protect.
3. Real secrets: `BETTER_AUTH_SECRET`, database credentials, SMTP, storage.
4. Storage. R2 is the obvious fit given Cloudflare is already in the stack, and
   the S3 client we use works against it unchanged.
5. Mail. Nothing about activation, invitation, or password reset works without
   it, and mail that lands in spam is the same as no mail: SPF, DKIM, DMARC on
   the sending domain, and a check that the first message actually arrives.
6. The sweep needs a scheduler. `/api/platform/sweep` exists and nothing calls
   it, so domain verification and invitation expiry are currently manual.
7. Backups, and a restore that has actually been run. An untested backup is a
   belief, not a backup.
8. Provision the first real institute and take one custom domain all the way to
   serving. That closes the loop the whole of phase 3 was built for.

## Phase 6: enrollment without money (P0-11)

What makes an institute usable before payments exist. They enroll their own
students and teach; the platform never touches a card.

- Admin grants an enrollment, optional expiry, `granted_by` plus an audit row
- A student roster: who is here, what they hold, when it lapses
- Inviting students by email in bulk. The invitation machinery exists and has no
  admin screen
- Revoking access, which is the other half of granting it and easy to forget

## Phase 7: the player (P0-8)

The reason the product exists. Audio lectures people listen to on a phone,
usually while doing something else.

- A mini-player that survives navigation
- Position memory per lesson, synced server-side. The `progress` table is there
  and only the seed writes to it
- Playback speed and keyboard shortcuts
- Downloadable lessons where the institute allows it
- Reconcile lesson resources against the objects they point at (task 50). The
  fixture currently references audio that does not exist, so the player is inert
  against seeded data
- Real uploads: instructors putting actual audio in, which exercises the storage
  path end to end rather than through a test

## Phase 8: assessment

Deferred by the PRD and worth keeping deferred until an institute is teaching on
the platform and can say what they actually need. Quizzes, exams, grades, and a
gradebook are a large surface, and building them from imagination is how you get
a feature nobody uses.

## Phase 9: payments (P0-7)

Last on purpose. Nothing above depends on it, and it is the piece where being
wrong costs somebody money.

- Stripe Connect onboarding per institute
- Checkout that creates an order and an entitlement idempotently, because a
  webhook that arrives twice must not enroll twice or charge twice
- Refunds and what they do to access
- The application fee, per tenant, so design partners sit at zero

## Phase 10: before anybody who is not a friend uses it

- Self-host documentation good enough for a stranger, and a restore drill
- Accessibility pass. Known gap: the sign-in form's inputs have no labels
- Mobile pass, since a phone is where lectures get listened to
- Terms and privacy copy, which a platform holding other people's students'
  data needs before it takes signups
- Rate limits reviewed on every endpoint that sends mail or checks a password
- A security review of the whole surface, not just the parts that were fun

## Things that need somebody other than me

- A host, and the decision about who owns Postgres
- SMTP credentials and a sending domain with SPF, DKIM, DMARC
- R2 or another bucket, with credentials
- Stripe account, when phase 9 arrives
- The tunnel, which has to be created on the host itself
