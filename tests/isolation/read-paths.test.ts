import { afterAll, describe, expect, it } from 'vitest';
import { closeAdminDb } from '@/db/admin';
import { closeDb } from '@/db/client';
import { CORNERSTONE, GRACE } from '@/db/seed-data';
import { READ_PATHS } from '../helpers/read-paths';
import { ISOLATION_MODES, withScope } from '../helpers/scope';

/**
 * The suite the build hangs on (PRD section 10, P0-3).
 *
 * Every read path is exercised twice per isolation mode:
 *
 *   under its own tenant, where it must return data, and
 *   under the other tenant, where it must return nothing.
 *
 * The pairing is deliberate. A negative assertion on its own is satisfied by a
 * query that returns nothing under every condition, including a broken one.
 * The positive case is what proves the negative case had something to find.
 */

const TENANT_PAIRS = [
  { viewer: GRACE, subject: CORNERSTONE },
  { viewer: CORNERSTONE, subject: GRACE },
];

afterAll(async () => {
  await Promise.all([closeDb(), closeAdminDb()]);
});

describe.each(ISOLATION_MODES)('isolation mode: %s', (mode) => {
  describe.each(READ_PATHS)('$name', (readPath) => {
    it.each([GRACE, CORNERSTONE])(
      'returns the tenant own data under $slug',
      async (tenant) => {
        const found = await withScope(mode, tenant.id, (scope) =>
          readPath.run(scope, tenant),
        );

        expect(
          found.length,
          `${readPath.name} returned nothing for its own tenant, so the ` +
            'cross-tenant assertion below would pass vacuously',
        ).toBeGreaterThan(0);
      },
    );

    it.each(TENANT_PAIRS)(
      'returns nothing belonging to $subject.slug when scoped to $viewer.slug',
      async ({ viewer, subject }) => {
        const leaked = await withScope(mode, viewer.id, (scope) =>
          readPath.run(scope, subject),
        );

        expect(
          leaked,
          `${readPath.name} leaked ${subject.name} rows to ${viewer.name}`,
        ).toEqual([]);
      },
    );
  });
});
