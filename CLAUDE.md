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
- Adding a second section to a course has no UI right now. `/teach` used to
  have an inline "Add module" form; retiring that page in chunk 4 removed it
  along with everything else /teach no longer renders, and the replacement
  editor (`/courses/[courseId]/edit`, chunk 3) never had one. The server
  action, `addModuleAction` in `src/app/(tenant)/teach/actions.ts`, still
  works and has no caller. Whoever adds this back needs to design around
  `tests/e2e/catalog.spec.ts`'s "never mentions sections" test: the editor is
  deliberately silent about sections for the common one-section course, so
  the control needs progressive disclosure, not a form that is just always
  there.
- UI library decision, next up: the user wants screens rebuilt on React Suite
  (rsuite), modals included. Nothing uses it yet; every screen so far is
  plain Tailwind plus native elements (`<dialog>` for `AddLessonDialog`,
  `window.confirm` for the two archive buttons). This is a cross-cutting
  adoption across the whole app, not scoped to any one round-2 chunk, so per
  the user's own instruction it gets a written plan first, checked with them
  before any rsuite code lands: which components rsuite replaces first,
  whether Tailwind and rsuite's own styling coexist or one wins, and whether
  native `<dialog>`/`confirm` get swapped for rsuite's `Modal` as part of the
  same pass.
- Roll the Cloudflare API token and the Brevo API key, both exposed in an
  earlier session transcript.
- R2 bucket wants recreating in ENAM: it was made in APAC and location is fixed
  at creation.
- Not built: payments, grading, assessments, bulk import and export, the
  per-institute API and MCP server.
