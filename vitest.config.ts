import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The markdown renderer produces React elements rather than HTML, so its
  // tests import a .tsx module. Next compiles JSX for the app; vitest needs
  // telling separately, and the automatic runtime means no React import.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/isolation/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // The isolation suite shares one seeded database. Running files in a
    // single fork keeps connection counts predictable and stops one file from
    // reseeding while another reads.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
