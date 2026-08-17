import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

/**
 * Checks an environment file the way production will check it, before a deploy
 * rather than during one.
 *
 *   pnpm env:check .env.production
 *
 * WHY THIS EXISTS
 *
 * The application validates its environment at startup and refuses to serve on
 * anything invalid, which is the right behaviour and a poor way to find out.
 * The failure arrives as a container that will not stay up, at the moment
 * somebody is deploying, and the message scrolls past in a log.
 *
 * It found a real one immediately: docker-compose.prod.yml passed no mail
 * variables at all, and src/env.ts refuses to serve in production without
 * SMTP_HOST and MAIL_FROM. The stack as written would not have booted on its
 * first deploy.
 *
 * The check runs the same schema and the same production assertions the
 * application does, in a child process with the file's variables and nothing
 * else, so it cannot pass by accident on values that happen to be in the
 * developer's shell.
 */

const DEV_ONLY_VALUES = [
  // Things that are fine locally and are a security incident in production.
  { pattern: /^lamplight-demo-password$/, name: 'the seeded demo password' },
  { pattern: /localhost|127\.0\.0\.1/, name: 'a local address' },
  {
    pattern: /^lamplight_(app|admin)_password$/,
    name: 'a development password',
  },
];

async function main(): Promise<void> {
  const path = resolve(process.argv[2] ?? '.env.production');

  if (!existsSync(path)) {
    console.error(`No such file: ${path}`);
    console.error('Usage: pnpm env:check <path-to-env-file>');
    process.exitCode = 1;
    return;
  }

  const parsed = parse(readFileSync(path));
  console.log(`checking ${path}, ${Object.keys(parsed).length} variables\n`);

  // A child process with exactly these variables. Inheriting the shell would
  // mean a value the deploying machine happens to have makes a broken file
  // look complete, which is the failure this is meant to prevent.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(import.meta.dirname, 'env-probe.ts')],
    {
      env: { ...parsed, NODE_ENV: 'production', PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();

  if (result.status !== 0) {
    console.error('This environment would not start:\n');
    console.error(output);
    console.error(
      '\nFix the values above. The application makes the same check at boot,',
    );
    console.error(
      'so deploying this would produce a container that will not stay up.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('the application would start with this environment');

  // Not fatal. These are judgements rather than rules, and an operator running
  // a staging box may mean every one of them.
  const suspicious: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    for (const check of DEV_ONLY_VALUES) {
      if (check.pattern.test(value)) {
        suspicious.push(`  ${key} looks like ${check.name}`);
      }
    }
  }

  if (suspicious.length > 0) {
    console.log('\nworth a second look:');
    console.log(suspicious.join('\n'));
  }

  const secret = parsed.BETTER_AUTH_SECRET ?? '';
  if (secret && secret.length < 48) {
    console.log(
      `\n  BETTER_AUTH_SECRET is ${secret.length} characters. 32 is the minimum` +
        ' and 48 or more is better.',
    );
  }

  if (!parsed.DOMAIN_SWEEP_SECRET) {
    console.log(
      '\n  DOMAIN_SWEEP_SECRET is unset, so the sweep endpoint answers 404 and' +
        '\n  nothing periodic runs: custom domains never finish verifying on' +
        '\n  their own and invitations are never deleted.',
    );
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
