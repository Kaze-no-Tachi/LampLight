import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

/**
 * The environment every test process needs, applied as a side effect of
 * importing this file.
 *
 * Imported by BOTH tests/setup.ts and tests/global-setup.ts, and that is the
 * point of the file existing. These are different processes at different
 * times: global setup runs once before anything else and seeds the database,
 * setup files run per test file. The fallbacks used to live only in the setup
 * file, so global setup ran without them, and the day the seed started needing
 * a signing secret (it hashes fixture passwords through Better Auth) the suite
 * passed on any machine with a populated .env and failed in CI before a single
 * test ran.
 *
 * That is the second time a "green locally, red in CI" failure has come from
 * exactly this gap. One file now, imported everywhere it is needed.
 */

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
 * Assigns only when a variable is absent or blank.
 *
 * `??=` is not enough: .env.example ships later-phase variables as `FOO=`, so
 * a copied .env leaves them as empty strings rather than undefined, and an
 * empty string is not nullish. That silently defeated these defaults once
 * already.
 */
function fallback(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

/**
 * A signing secret for tests that exercise the auth layer.
 *
 * Set here rather than in the CI workflow because a suite that only passes on
 * a machine with a populated .env is a suite that lies. A real value wins if
 * one is present, so this changes nothing for anybody who has configured one,
 * and it never reaches an environment that matters: the only sessions it can
 * sign are ones minted against a test database.
 */
fallback('BETTER_AUTH_SECRET', 'vitest_development_secret_at_least_32_chars');

/**
 * Placeholder Cloudflare configuration, for the same reason.
 *
 * The custom domain code refuses to do anything when the platform is not
 * configured for custom hostnames, which is correct behaviour and is covered
 * separately in tests/unit/cloudflare.test.ts. Every test that exercises the
 * domain lifecycle injects a stub client, so nothing here dials out, and a
 * path that did reach the real API would fail loudly on a fake token rather
 * than quietly pass.
 */
fallback('CLOUDFLARE_ZONE_ID', 'vitest-zone');
fallback('CLOUDFLARE_API_TOKEN', 'vitest-token');
fallback('CLOUDFLARE_SAAS_FALLBACK_ORIGIN', 'origin.lamplight.school');
