import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Locks the ESLint guard that keeps the RLS-bypassing database client out of
 * feature code.
 *
 * This is tested rather than trusted because the guard is a glob, and a glob
 * that silently stops matching is worse than no guard at all: `pnpm lint`
 * keeps passing while the protection is gone. Directory layouts move around
 * over nine phases. If someone renames the superadmin route group or relocates
 * the seed script, this test says so.
 */

const IMPORTS_ADMIN_CLIENT = `import { getAdminDb } from '@/db/admin';\nexport const db = getAdminDb;\n`;

const RULE = 'no-restricted-imports';

let eslint: ESLint;

async function violatesBan(filePath: string): Promise<boolean> {
  const results = await eslint.lintText(IMPORTS_ADMIN_CLIENT, { filePath });
  return results.some((result) =>
    result.messages.some((message) => message.ruleId === RULE),
  );
}

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

describe('admin client import ban', () => {
  it.each([
    'src/app/(tenant)/courses/page.tsx',
    'src/app/api/lessons/route.ts',
    'src/components/course-list.tsx',
    'src/lib/entitlements.ts',
    'src/db/repositories/catalog.ts',
    'src/db/client.ts',
  ])('blocks the import from %s', async (filePath) => {
    expect(
      await violatesBan(filePath),
      `${filePath} can import the RLS-bypassing client. Feature code must go ` +
        'through getTenantDb(tenantId)',
    ).toBe(true);
  });

  it.each([
    'src/db/migrate.ts',
    'src/db/seed.ts',
    'src/db/reset.ts',
    'src/app/(platform)/superadmin/page.tsx',
    'src/app/(platform)/superadmin/tenants/[id]/page.tsx',
    'tests/isolation/read-paths.test.ts',
    'tests/helpers/scope.ts',
  ])('allows the import from %s', async (filePath) => {
    expect(
      await violatesBan(filePath),
      `${filePath} is on the allowlist but the import is being blocked, so ` +
        'the allowlist glob no longer matches where the file actually lives',
    ).toBe(false);
  });
});
