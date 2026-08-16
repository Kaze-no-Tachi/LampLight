import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Local runs read .env, CI injects real environment variables. .env.test wins
// where present so a developer cannot point the destructive test helpers at a
// development database by accident.
for (const file of ['.env.test', '.env']) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) {
    loadEnv({ path, override: false });
  }
}

/**
 * A signing secret for tests that exercise the auth layer.
 *
 * Set here rather than in the CI workflow because a suite that only passes on
 * a machine with a populated .env is a suite that lies. The password reset
 * tests went green locally and red in CI for exactly that reason: the secret
 * was in a developer's .env and nowhere else.
 *
 * A real value wins if one is present, so this changes nothing for anybody who
 * has configured one, and it never reaches an environment that matters: the
 * only sessions it can sign are ones minted against a test database.
 */
process.env.BETTER_AUTH_SECRET ??=
  'vitest_development_secret_at_least_32_chars';
