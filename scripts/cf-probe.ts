import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import {
  CloudflareError,
  createCustomHostnameClient,
  customHostnamesConfigured,
  fetchTransport,
} from '@/lib/cloudflare/custom-hostnames';

/**
 * Talks to the real Cloudflare API, once, on purpose.
 *
 * WHY THIS EXISTS
 *
 * Everything in the custom hostname path is tested against an injected fake
 * transport, which is the right way to test decisions and the wrong way to
 * learn what Cloudflare actually returns. A fake asserts the shape somebody
 * believed in when they wrote it. This asserts the shape Cloudflare sends.
 *
 * It goes through createCustomHostnameClient rather than curl, so what runs
 * here is the code that runs in production, including the error mapping.
 *
 * WHAT IT DOES
 *
 *   pnpm tsx scripts/cf-probe.ts <hostname> [--keep]
 *
 * Lists what the zone already has, creates the hostname, reads it back, prints
 * the DNS the institute would be told to create, and deletes it again unless
 * --keep is passed. A created hostname changes nothing about the named
 * domain's DNS: it registers intent on our zone and waits for a TXT record
 * that only the domain's owner can publish.
 *
 * It never prints the token. Run it with the credentials in the environment:
 *
 *   CLOUDFLARE_ZONE_ID=... CLOUDFLARE_API_TOKEN=... \
 *   CLOUDFLARE_SAAS_FALLBACK_ORIGIN=origin.lamplight.school \
 *   pnpm tsx scripts/cf-probe.ts probe.example.edu
 */

loadEnv();

async function main(): Promise<void> {
  const [hostname, ...flags] = process.argv.slice(2);
  const keep = flags.includes('--keep');

  if (!hostname) {
    throw new Error('usage: pnpm tsx scripts/cf-probe.ts <hostname> [--keep]');
  }

  if (!customHostnamesConfigured()) {
    throw new Error(
      'Custom hostnames are not configured. Needs TENANCY_MODE=platform, ' +
        'CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN, and ' +
        'CLOUDFLARE_SAAS_FALLBACK_ORIGIN.',
    );
  }

  const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? '';
  const token = process.env.CLOUDFLARE_API_TOKEN ?? '';

  // The client has no list method, because the application never needs one:
  // it knows the ids it stored. A probe does need one, to say what is already
  // there before it adds anything.
  const existing = await fetchTransport(
    { method: 'GET', path: `/zones/${zoneId}/custom_hostnames?per_page=50` },
    token,
  );
  console.log(`zone ${zoneId}: ${describeList(existing.json)}`);

  const client = createCustomHostnameClient();

  console.log(`\ncreating ${hostname}`);
  const created = await client.create(hostname);
  console.log(JSON.stringify(created, null, 2));

  console.log('\nreading it back');
  const fetched = await client.get(created.id);
  console.log(`status: ${fetched.status}`);

  if (keep) {
    console.log(`\nkeeping ${created.id}. Delete it when you are done.`);
    return;
  }

  await client.remove(created.id);
  console.log(`\ndeleted ${created.id}`);
}

function describeList(json: unknown): string {
  const envelope = json as { success?: boolean; result?: unknown[] };
  if (!envelope?.success) return `unexpected response ${JSON.stringify(json)}`;

  const rows = envelope.result ?? [];
  if (rows.length === 0) return 'no custom hostnames yet';

  return `${rows.length} custom hostname(s): ${rows
    .map((row) => (row as { hostname?: string }).hostname ?? '?')
    .join(', ')}`;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    if (error instanceof CloudflareError) {
      // The mapping is part of what is being probed, so the kind is printed
      // rather than just the message.
      console.error(`CloudflareError (${error.kind}): ${error.message}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
