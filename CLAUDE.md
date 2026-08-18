# Working on Lamplight

An open-source multi-tenant LMS for bible institutes. One deployment serves many
institutes, each on its own hostname, and the isolation between them is the
product. Requirements are in `lecternprdv0.2.md`; deployment is in
`docs/runbook.md`; what is planned is in `docs/roadmap.md` and `docs/plans/`.

## The gate, before every commit

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm exec tsx scripts/check-no-em-dash.ts
pnpm test                       # unit and isolation, needs docker compose up -d
pnpm test:e2e                   # browser suite
```

The browser suite needs Postgres and Minio: `docker compose up -d postgres minio
minio-init`. In this container the daemon sometimes needs starting first
(`dockerd &`), and Playwright needs `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## Rules that are not negotiable

**Tenant isolation is two layers.** Application scoping through `TenantScope`
(`src/db/scope.ts`), plus Postgres RLS on the `app.tenant_id` GUC. The
application role has no BYPASSRLS. Feature code uses `getTenantDb(tenantId)`;
`src/db/admin.ts` bypasses RLS and is banned by ESLint outside migration
tooling, the superadmin console, and tests.

**Every read path goes in the registry.** Adding an exported function to
`src/db/repositories/` means adding it to `tests/helpers/read-paths.ts` in the
same commit. `tests/isolation/read-path-coverage.test.ts` enforces it, and the
harness refuses a positive case that returns nothing, because an assertion over
an empty result passes vacuously in both directions. See
`docs/isolation-harness.md`.

**Host-dependent routes must be `force-dynamic`.** A prerendered tenant page is
one institute's HTML served to another. CI greps the build output for it.

**Hiding a button is not authorization.** `can()` in `src/lib/access/can.ts` is
called twice: once by the page to decide what to render, once by the server
action to decide whether to do it. The second is the one that matters.

**Never quote fees, never promise outcomes, no em dashes anywhere.** The em dash
rule is enforced by a script and by CI.

## How work is verified here

Run the thing, do not assert that it works. Several bugs this project has
shipped were covered by tests that passed for the wrong reason: a sign-out
button that returned 415 and was never checked, an unpublished course absent
from the catalogue list and readable by its direct URL, a "replace audio"
button that appended. When adding a guard, break it on purpose and confirm the
test fails; a mutation that silently misses (because Prettier reformatted the
line you patched) is not a passing mutation test.

Commit messages are the project's record of why. Write them for somebody
reading `git log` in six months with none of this context.

## Deployment, in one paragraph

CI builds and publishes both images to GHCR on pushes to `main`; the VPS only
pulls. Dokploy's Run Command must start at `compose`, not `docker compose`, and
must include `--pull always` or a moved `:latest` tag is not re-fetched. There
is no pre-deploy hook: `docker-compose.prod.yml` orders migrations so `app`
waits for `migrate` to exit successfully. The box exposes nothing but SSH, and
`ufw` alone does not achieve that because Docker publishes past it.

## Outstanding

- `docs/plans/course-flow-round-2.md` is done: all five chunks complete,
  including chunk 5's cleanup (`settings/catalog` and
  `teach/courses/[courseId]` deleted, catalogue administration folded into
  `/teach`).
- The visual reskin is done, seven screens of it, on
  `reskin/student-surfaces` and not yet merged. Catalogue, course detail,
  student shelf, lesson player and mini player came first; then the staff
  sidebar shell, the teaching list, and the four authoring screens (new
  course, add a lesson, course settings, lesson editor); then people,
  branding and the superadmin console. The design handoff is
  `UI mockup request.zip`, whose README describes the app as unbuilt and
  claims shadcn/ui: both are wrong, and it predates round 2, so it conflicts
  with the real structure in several places. Each conflict is argued in the
  commit that resolved it rather than silently reversed.
- Adding a second section to a course has UI again, on the add-a-lesson page
  (`/teach/courses/[courseId]/lessons/new`), behind a "Put it in a new
  section" link that only becomes a picker once a course has more than one.
  `addModuleAction` still exists and is still uncalled: the page goes through
  `resolveModule` in `src/lib/catalog/authoring.ts`, which also refuses a
  section belonging to another course. Retire the action or point something at
  it. The one-section silence round 2 decided on is intact and
  `tests/e2e/catalog.spec.ts` asserts it on both screens.
- rsuite adoption is under way, plan and progress in
  `docs/plans/rsuite-adoption.md`. Decided: coexists with Tailwind (Tailwind
  keeps layout/spacing/typography, rsuite takes interactive controls only),
  one screen per commit. Phase 1 (foundations: rsuite installed,
  `RsuiteProvider`, the `--rs-*` theming bridge in
  `src/lib/theme/theme.ts`'s `resolveRsuiteTokens`) and phase 2 (the two
  native dialogs, now rsuite `Modal`, via a new shared `ConfirmModal` for
  the two archive confirmations) are both done. rsuite's own CSS was
  actually never loading anywhere in the app until it was fixed alongside
  a real `/platform-home` page (`src/app/globals.css` now imports
  `rsuite/dist/rsuite-no-reset.css`); check any earlier screenshot or
  visual impression of a rsuite Button/Modal predating that fix against a
  fresh one before trusting it. Phase 3 (forms and controls on `/teach`) and
  most of phase 4 (`/settings/people`) went in with the reskin, since the
  screens were being rebuilt anyway: `Input`, `SelectPicker`, `Toggle`,
  `Checkbox`, `Slider`, `Modal`, `RadioGroup`. Two controls were tried and
  rejected on purpose, both recorded in the code: rsuite's `DatePicker` on
  the enrolment panel (cannot be driven from the browser suite, and a silently
  unset expiry is not acceptable there) and `InputNumber` is kept only for the
  price field. Still on Tailwind: `/settings/domains`, `/settings/signup`, and
  every student surface.
- `/platform-home` (the apex domain, lamplight.school itself) is a basic
  real page now, not the placeholder stub it was: a hero, a short
  description, three rsuite `Panel` feature blurbs, no call to action
  (there is no contact address or request-access flow anywhere in the
  codebase to point one at). The user is about to do a full visual reskin
  of the whole app in Claude Design in a separate session, so this was kept
  deliberately basic rather than polished twice.
- **The browser suite is updated but has never been run.** `pnpm test:e2e`
  starts its own server with `pnpm build && pnpm start`, and `pnpm build`
  fails on Windows with EPERM symlink errors from `output: 'standalone'`, so
  none of the reskin's spec changes have executed anywhere yet. Worse, the
  suite was already failing before the reskin: commit `3a03fec` moved
  `/courses/[courseId]/edit` to `/teach/courses/[courseId]` and updated no
  spec. CI on Linux is the first thing that will actually run these. Expect
  breakage and read the failures as selector drift before assuming the
  product is wrong.
- `/` is the last screen on pre-reskin styling. It duplicates the catalogue's
  hero, its programs and a four-course taste. No mockup covers it, so it
  needs design input first; deferred deliberately, not forgotten.
- Roll the Cloudflare API token and the Brevo API key, both exposed in an
  earlier session transcript. This matters more before a deploy than on an
  ordinary day.
- R2 bucket wants recreating in ENAM: it was made in APAC and location is fixed
  at creation.
- Not built: payments, grading, assessments, bulk import and export, the
  per-institute API and MCP server. Course settings can now set a price
  (`products.price_cents`, `courses.is_standalone_purchasable`) and the
  catalogue displays it, but nothing takes a payment, and the copy on that
  field says so rather than promising Stripe.
