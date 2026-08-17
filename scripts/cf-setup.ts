import { pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';

/**
 * One-time Cloudflare setup for a platform deployment.
 *
 * WHAT THIS IS FOR
 *
 * Custom hostnames need two things on the zone that the application assumes
 * exist and never creates: a proxied DNS record for the fallback origin, and
 * the zone's fallback origin pointed at it. Until now that was two paragraphs
 * in a runbook, which is the kind of setup step that is done once by the person
 * who wrote it and then forgotten by everyone who self-hosts afterwards. An
 * assumption worth writing down is worth making executable.
 *
 * WHAT IT DOES
 *
 *   pnpm cf:setup [--target <hostname-or-ip>] [--dry-run] [--skip-platform-dns]
 *
 * Idempotent, and says so: it reports what is already correct rather than
 * rewriting it. Re-running after pointing --target at a real tunnel is the
 * intended way to move the origin later.
 *
 * The fallback origin is where Cloudflare sends traffic for every institute's
 * custom domain, so it must be a proxied record inside the platform zone.
 * Without a tunnel yet, the default target is 192.0.2.1, which is reserved for
 * documentation and routes nowhere on purpose: the record has to exist and be
 * orange-clouded before Cloudflare will accept it as a fallback origin, and a
 * placeholder that obviously points at nothing is better than one that looks
 * like it might be a real server.
 *
 * IT ALSO POINTS THE PLATFORM'S OWN HOSTNAMES AT THE TUNNEL
 *
 * The fallback origin alone carries custom domains and nothing else. The apex
 * and every institute subdomain need records of their own, and this script
 * used to leave them out, which is a deployment that resolves for institutes
 * who brought their own domain and for nobody else: grace.<apex> would simply
 * not exist. So a real --target also ensures:
 *
 *   <apex>    CNAME -> target, proxied     the platform home
 *   *.<apex>  CNAME -> target, proxied     every institute subdomain
 *
 * The wildcard is what makes onboarding an institute a database write rather
 * than a DNS change. Skipped when the target is the placeholder, because
 * pointing a live apex at an address that routes nowhere is worse than leaving
 * it alone, and skippable entirely with --skip-platform-dns for a deployment
 * whose apex DNS is managed somewhere else.
 */

loadEnv();

const API = 'https://api.cloudflare.com/client/v4';

/** Documentation range (RFC 5737). Reachable from nowhere, by design. */
const PLACEHOLDER_TARGET = '192.0.2.1';

/**
 * Record types that answer "where does this hostname point".
 *
 * Filtering by these matters more than it looks. Cloudflare's list endpoint
 * filters by name, and an apex typically carries MX and TXT records alongside
 * its address record. Taking the first row back would have found an MX record
 * for the mail forwarder and tried to rewrite it into a CNAME to the tunnel,
 * which is how you take down a domain's email while setting up its website.
 */
const ADDRESS_TYPES = new Set(['A', 'AAAA', 'CNAME']);

type Json = Record<string, unknown>;

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  return { status: response.status, json: (await response.json()) as Json };
}

function assertSuccess(response: { status: number; json: Json }, what: string) {
  if (response.json.success === true) return;

  const errors = (response.json.errors ?? []) as { message?: string }[];
  const detail =
    errors
      .map((error) => error.message)
      .filter(Boolean)
      .join('; ') || `HTTP ${response.status}`;

  throw new Error(`${what}: ${detail}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipPlatformDns = args.includes('--skip-platform-dns');
  const targetIndex = args.indexOf('--target');
  const target =
    targetIndex >= 0 ? (args[targetIndex + 1] ?? '') : PLACEHOLDER_TARGET;

  const token = required('CLOUDFLARE_API_TOKEN');
  const zoneId = required('CLOUDFLARE_ZONE_ID');
  const fallbackOrigin = required('CLOUDFLARE_SAAS_FALLBACK_ORIGIN');

  const zone = await call('GET', `/zones/${zoneId}`, token);
  assertSuccess(zone, 'Could not read the zone');
  const zoneName = String((zone.json.result as Json).name ?? '');
  console.log(`zone: ${zoneName}`);

  // Cloudflare will reject a fallback origin outside the zone, but the error
  // is generic. Catching it here says which of the two values is wrong.
  if (fallbackOrigin !== zoneName && !fallbackOrigin.endsWith(`.${zoneName}`)) {
    throw new Error(
      `CLOUDFLARE_SAAS_FALLBACK_ORIGIN (${fallbackOrigin}) is not inside ` +
        `the zone (${zoneName}). The fallback origin has to be a hostname ` +
        'in the platform zone, because Cloudflare has to be able to proxy it.',
    );
  }

  await ensureRecord({
    token,
    zoneId,
    name: fallbackOrigin,
    label: 'fallback origin',
    comment: 'Lamplight custom hostname fallback origin',
    target,
    dryRun,
  });
  await ensureFallbackOrigin({ token, zoneId, fallbackOrigin, dryRun });

  if (skipPlatformDns) {
    console.log('platform dns: skipped by --skip-platform-dns');
  } else if (target === PLACEHOLDER_TARGET) {
    console.log(
      'platform dns: skipped while the target is the placeholder. Re-run ' +
        'with --target <uuid>.cfargotunnel.com once the tunnel exists.',
    );
  } else {
    await ensureRecord({
      token,
      zoneId,
      name: zoneName,
      label: 'apex',
      comment: 'Lamplight platform apex',
      target,
      dryRun,
    });
    await ensureRecord({
      token,
      zoneId,
      name: `*.${zoneName}`,
      label: 'wildcard',
      comment: 'Lamplight institute subdomains',
      target,
      dryRun,
    });
  }

  console.log(
    '\nCustom hostnames are ready. Institutes can add domains, and each one ' +
      `will be told to CNAME to ${fallbackOrigin}.`,
  );
}

/** One proxied record pointing a name at the origin. */
async function ensureRecord(params: {
  token: string;
  zoneId: string;
  name: string;
  label: string;
  comment: string;
  target: string;
  dryRun: boolean;
}): Promise<void> {
  const { token, zoneId, name, label, comment, target, dryRun } = params;

  // An IP is an A record and a hostname is a CNAME. A tunnel is the latter
  // (<id>.cfargotunnel.com), which is the shape this ends up in for real.
  const type = /^\d+\.\d+\.\d+\.\d+$/.test(target) ? 'A' : 'CNAME';

  const existing = await call(
    'GET',
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`,
    token,
  );
  assertSuccess(existing, 'Could not list DNS records');

  // Only the records that answer where this name points. MX and TXT records
  // sharing the name are somebody else's business and must survive untouched.
  const rows = ((existing.json.result ?? []) as Json[]).filter((row) =>
    ADDRESS_TYPES.has(String(row.type)),
  );

  if (rows.length > 1) {
    throw new Error(
      `${label}: ${name} has ${rows.length} address records ` +
        `(${rows.map((row) => `${String(row.type)} ${String(row.content)}`).join(', ')}). ` +
        'Refusing to guess which one is the origin. Remove the extras first.',
    );
  }

  const current = rows[0];

  if (!current) {
    console.log(`${label}: creating ${type} ${name} -> ${target}`);
    if (dryRun) return;

    const created = await call('POST', `/zones/${zoneId}/dns_records`, token, {
      type,
      name,
      content: target,
      // Orange cloud. A grey-clouded record cannot be a fallback origin,
      // because Cloudflare has nothing to terminate TLS on.
      proxied: true,
      comment,
    });
    assertSuccess(created, 'Could not create the record');
    console.log(`${label}: created`);
    return;
  }

  const matches =
    current.type === type &&
    current.content === target &&
    current.proxied === true;

  if (matches) {
    console.log(`${label}: already ${type} ${name} -> ${target}, proxied`);
    return;
  }

  console.log(
    `${label}: updating ${String(current.type)} ${String(current.content)} ` +
      `(proxied ${String(current.proxied)}) -> ${type} ${target} (proxied true)`,
  );
  if (dryRun) return;

  const updated = await call(
    'PATCH',
    `/zones/${zoneId}/dns_records/${String(current.id)}`,
    token,
    { type, name, content: target, proxied: true },
  );
  assertSuccess(updated, 'Could not update the record');
  console.log(`${label}: updated`);
}

/** The zone setting that tells Cloudflare where custom hostnames resolve. */
async function ensureFallbackOrigin(params: {
  token: string;
  zoneId: string;
  fallbackOrigin: string;
  dryRun: boolean;
}): Promise<void> {
  const { token, zoneId, fallbackOrigin, dryRun } = params;
  const path = `/zones/${zoneId}/custom_hostnames/fallback_origin`;

  const current = await call('GET', path, token);
  // A zone that has never had one answers with an error rather than an empty
  // result, so this read is allowed to fail without stopping the run.
  const origin =
    current.json.success === true
      ? String((current.json.result as Json)?.origin ?? '')
      : '';
  const status =
    current.json.success === true
      ? String((current.json.result as Json)?.status ?? 'unknown')
      : 'not set';

  if (origin === fallbackOrigin) {
    console.log(`fallback origin: already ${origin} (${status})`);
    return;
  }

  console.log(
    `fallback origin: setting to ${fallbackOrigin}` +
      (origin ? ` (was ${origin})` : ''),
  );
  if (dryRun) return;

  const put = await call('PUT', path, token, { origin: fallbackOrigin });
  assertSuccess(put, 'Could not set the fallback origin');
  console.log(
    `fallback origin: ${String((put.json.result as Json)?.status ?? 'set')}. ` +
      'It takes a few minutes to become active.',
  );
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set.`);
  return value;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
