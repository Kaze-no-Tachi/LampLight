import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import prettier from 'eslint-config-prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Import patterns that reach the RLS-bypassing superadmin database client.
 * Relative forms are listed too, otherwise a file inside src/db could sidestep
 * the ban with `./admin`.
 */
const ADMIN_CLIENT_PATTERNS = [
  '@/db/admin',
  '**/db/admin',
  './admin',
  '../admin',
];

const ADMIN_CLIENT_MESSAGE = [
  'src/db/admin.ts bypasses row-level security and is the single place that can',
  'read across tenants. Import it only from migration tooling, superadmin routes,',
  'or the isolation harness. Feature code must use getTenantDb(tenantId) instead.',
].join(' ');

/**
 * The only files allowed to import the unscoped client. Keep this list short.
 * Adding an entry is a security decision, not a convenience one.
 */
const ADMIN_CLIENT_ALLOWLIST = [
  'src/db/migrate.ts',
  'src/db/seed.ts',
  'src/db/reset.ts',
  // Runs once, by hand, to create the first platform operator. There is no
  // tenant to scope to: the row it writes is what makes somebody an operator
  // above every tenant, and the account it creates belongs to none of them.
  'src/db/bootstrap-admin.ts',
  'src/app/(platform)/superadmin/**',
  'tests/isolation/**',
  'tests/helpers/**',
];

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'drizzle/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Non-null assertions are allowed only with an inline disable carrying a
      // reason, which is how the "explain why" rule gets enforced mechanically.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ADMIN_CLIENT_PATTERNS,
              message: ADMIN_CLIENT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: ADMIN_CLIENT_ALLOWLIST,
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  prettier,
];

export default eslintConfig;
