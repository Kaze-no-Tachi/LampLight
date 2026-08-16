# The cross-tenant isolation harness

This is the suite that blocks merges. If it goes red, something can read
another institute's data.

Run it with `pnpm test:isolation`, or as part of `pnpm test`.

## What it is made of

| File                                         | Question it answers                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `tests/isolation/read-paths.test.ts`         | Does every repository read path refuse to return another tenant's rows?        |
| `tests/isolation/rls-enforcement.test.ts`    | With no repository code involved, does Postgres itself refuse?                 |
| `tests/isolation/rls-coverage.test.ts`       | Does every tenant-owned table actually have RLS enabled, forced, and policied? |
| `tests/isolation/read-path-coverage.test.ts` | Is every exported repository function registered in the suite?                 |

## The two isolation modes

Every read path runs twice.

**`both-layers`** goes through `getTenantDb`, connecting as the application
role with row-level security active. This is production behaviour.

**`app-layer-only`** runs the same repository function against the
RLS-bypassing admin connection. The database stops filtering, so the only thing
between the caller and another tenant's rows is the
`eq(table.tenantId, scope.tenantId)` inside the repository.

The second mode is the one that earns its keep. With RLS active, a repository
that lost its tenant filter still returns correct results, because the database
covers for it. A suite that only ran in production configuration would stay
green while the application layer rotted, and the rot would surface the first
time something ran as a bypassing role: a superadmin route, a migration, a
self-hoster who wired one connection string for everything.

## Why the fixture looks the way it does

Both seeded tenants are built from the same template, so every human-readable
identifier collides: same course slugs, same program slugs, same lesson titles,
same module structure. A leak therefore does not look like obviously foreign
data. It looks exactly like what the caller expected, which is the failure mode
a test has to be built to catch rather than stumble into.

Two fixture details do specific work:

**The shared student.** `shared.student@example.test` holds a membership at
both institutes, and holds the _same active entitlement_ (the hermeneutics
course) at both. So when the suite asks "does this person have access to the
other tenant's hermeneutics course", a correctly scoped query says no, while a
query that lost its tenant filter finds the other tenant's enrollment row and
says yes. Without a person who exists on both sides, that mistake is invisible:
the user simply is not found either way.

**The positive case.** Each read path is asserted in both directions: non-empty
under its own tenant, empty under the other. A negative assertion on its own is
satisfied by a query that returns nothing under every condition, including a
broken one. The positive case is what proves the negative case had something to
find.

## Verifying the harness actually bites

Remove the tenant filter from a repository function and the suite must fail.
The clearest single-line demonstration is a read that queries one table:

```diff
--- a/src/db/repositories/entitlements.ts
     .where(
       and(
-        eq(enrollments.tenantId, scope.tenantId),
         eq(enrollments.userId, userId),
```

```
pnpm test:isolation
```

```
× app-layer-only > 'entitlements.hasActiveEntitlement' > returns nothing belonging to 'cornerstone' when scoped to 'grace'
  → entitlements.hasActiveEntitlement leaked Cornerstone Baptist Institute rows to Grace Bible Institute
```

Note that it fails in `app-layer-only` and passes in `both-layers`. That is the
design working: RLS caught the leak in production configuration, and the second
mode is what told you the application layer had a hole.

### One thing to know before you test it yourself

Reads that join across tables carry the tenant filter in more than one place.
`findCourseBySlug`, for instance, filters `courses.tenant_id` in its `WHERE`
**and** joins `products` on `products.tenant_id`. Deleting either one alone
does not produce a leak, because the other still constrains the result through
the composite key, so the suite correctly stays green: there is nothing to
catch. Delete the tenant scoping from a joined read _entirely_ and it fails.

Verified across all ten read paths: removing a function's tenant scoping
completely is caught in every case. Removing one filter from a doubly-scoped
query is not caught, and should not be, because it is not a leak.

## The rule for later phases

**A new read path is added to `tests/helpers/read-paths.ts` in the same commit
that introduces it.** `read-path-coverage.test.ts` enforces this: export a
repository function without registering it and CI fails naming the function you
forgot. Same for tables. Add a tenant-owned table without adding it to
`src/db/tenant-tables.ts` and the RLS migration, and `rls-coverage.test.ts`
fails.
