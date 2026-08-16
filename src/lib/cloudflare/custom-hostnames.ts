import { getEnv, requireEnv } from '@/env';

/**
 * Cloudflare for SaaS custom hostnames (PRD section 5.3).
 *
 * Cloudflare issues and renews the TLS certificate for every institute's own
 * domain. This application never touches a certificate, never terminates TLS,
 * and never sees a private key. What it does is ask Cloudflare to start
 * managing a hostname, show the institute the DNS records Cloudflare asked
 * for, and poll until Cloudflare says the hostname is live.
 *
 * WHY THE TRANSPORT IS INJECTED
 *
 * Everything downstream of this file (the settings page, the sweep, the
 * status transitions) is logic worth testing, and none of it should require
 * credentials or reach the network from CI. So the one function that actually
 * speaks HTTP is a parameter, and the tests pass a fake that returns recorded
 * Cloudflare shapes. The alternative, mocking global fetch, tests that the
 * mock was called rather than that the code is right.
 */

export type DnsRecord = {
  /** What the institute has to create, verbatim. */
  readonly type: 'CNAME' | 'TXT';
  readonly name: string;
  readonly value: string;
  /** What this record is for, in words an institute's IT contact can act on. */
  readonly purpose: 'routing' | 'ownership';
};

export type CustomHostnameStatus =
  'pending' | 'verifying' | 'active' | 'failed';

export type CustomHostname = {
  readonly id: string;
  readonly hostname: string;
  readonly status: CustomHostnameStatus;
  readonly records: DnsRecord[];
  /** Cloudflare's own words about why it is not active yet, when it says any. */
  readonly message: string | null;
};

/**
 * Why a call failed, in the terms an operator has to act on.
 *
 * The distinction is not cosmetic. `taken` means another Cloudflare account
 * already manages this hostname, which the institute resolves with their
 * current provider. `auth` means our token is wrong, which only the platform
 * operator can fix. Collapsing them into "something went wrong" sends an
 * institute chasing a problem that is not theirs.
 */
export type CloudflareErrorKind = 'auth' | 'taken' | 'invalid' | 'unavailable';

export class CloudflareError extends Error {
  constructor(
    readonly kind: CloudflareErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CloudflareError';
  }
}

/** The seam. Anything that can answer like fetch will do. */
export type CloudflareTransport = (
  request: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    body?: unknown;
  },
  token: string,
) => Promise<{ status: number; json: unknown }>;

export const fetchTransport: CloudflareTransport = async (request, token) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4${request.path}`,
    {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
      // A slow Cloudflare must not hold a request handler open indefinitely.
      signal: AbortSignal.timeout(10_000),
    },
  );

  return { status: response.status, json: await response.json() };
};

export type CustomHostnameClient = {
  create(hostname: string): Promise<CustomHostname>;
  get(id: string): Promise<CustomHostname>;
  remove(id: string): Promise<void>;
};

export function createCustomHostnameClient(
  transport: CloudflareTransport = fetchTransport,
): CustomHostnameClient {
  const zoneId = requireEnv('CLOUDFLARE_ZONE_ID');
  const token = requireEnv('CLOUDFLARE_API_TOKEN');
  const fallbackOrigin = requireEnv('CLOUDFLARE_SAAS_FALLBACK_ORIGIN');
  const base = `/zones/${zoneId}/custom_hostnames`;

  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<CloudflareEnvelope> {
    let response;
    try {
      response = await transport({ method, path, body }, token);
    } catch (cause) {
      // A timeout or a DNS failure is Cloudflare being unreachable, which is
      // temporary and worth retrying, unlike anything in the 4xx range.
      throw new CloudflareError(
        'unavailable',
        `Cloudflare did not respond: ${String(cause)}`,
      );
    }

    const envelope = response.json as CloudflareEnvelope;

    if (response.status === 401 || response.status === 403) {
      throw new CloudflareError(
        'auth',
        'Cloudflare rejected the API token. Check CLOUDFLARE_API_TOKEN and its scopes.',
      );
    }
    if (response.status >= 500) {
      throw new CloudflareError(
        'unavailable',
        `Cloudflare returned ${response.status}.`,
      );
    }
    if (!envelope?.success) {
      throw classifyErrors(envelope?.errors ?? []);
    }

    return envelope;
  }

  return {
    async create(hostname) {
      const envelope = await call('POST', base, {
        hostname,
        // DV over HTTP would need the hostname already pointing at us, which
        // it does not yet. TXT proves ownership before any traffic moves, so
        // the institute's existing site keeps serving until they switch the
        // CNAME themselves.
        ssl: { method: 'txt', type: 'dv' },
      });

      return toCustomHostname(envelope.result, fallbackOrigin);
    },

    async get(id) {
      const envelope = await call('GET', `${base}/${id}`);
      return toCustomHostname(envelope.result, fallbackOrigin);
    },

    async remove(id) {
      await call('DELETE', `${base}/${id}`);
    },
  };
}

/** Whether the platform is configured to manage custom hostnames at all. */
export function customHostnamesConfigured(): boolean {
  const env = getEnv();
  return (
    env.TENANCY_MODE === 'platform' &&
    Boolean(env.CLOUDFLARE_ZONE_ID) &&
    Boolean(env.CLOUDFLARE_API_TOKEN) &&
    Boolean(env.CLOUDFLARE_SAAS_FALLBACK_ORIGIN)
  );
}

type CloudflareEnvelope = {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: unknown;
};

/**
 * Maps Cloudflare's error codes to something actionable.
 *
 * 1406 and 1407 are the duplicate-hostname family: the name is already managed
 * by a custom hostname somewhere, possibly on another Cloudflare account
 * entirely. That is the one an institute can actually do something about, and
 * the one most likely to happen in practice, so it gets its own kind.
 */
function classifyErrors(
  errors: { code?: number; message?: string }[],
): CloudflareError {
  const message =
    errors
      .map((error) => error.message)
      .filter(Boolean)
      .join('; ') || 'Cloudflare rejected the request.';

  const codes = new Set(errors.map((error) => error.code));
  if (codes.has(1406) || codes.has(1407)) {
    return new CloudflareError('taken', message);
  }
  if (codes.has(1401) || codes.has(1409)) {
    return new CloudflareError('invalid', message);
  }

  return new CloudflareError('invalid', message);
}

type RawHostname = {
  id?: unknown;
  hostname?: unknown;
  status?: unknown;
  verification_errors?: unknown;
  ownership_verification?: { type?: unknown; name?: unknown; value?: unknown };
  ssl?: {
    status?: unknown;
    validation_errors?: { message?: unknown }[];
    txt_name?: unknown;
    txt_value?: unknown;
  };
};

/**
 * Turns Cloudflare's response into the shape the rest of the application uses.
 *
 * Two separate states have to agree before a hostname actually serves: the
 * custom hostname itself must be active, and its certificate must be issued.
 * Reporting active on the first alone is how a domain gets marked verified in
 * our database and then answers with a TLS error for the next several minutes.
 */
function toCustomHostname(
  raw: unknown,
  fallbackOrigin: string,
): CustomHostname {
  const value = (raw ?? {}) as RawHostname;
  const hostname = typeof value.hostname === 'string' ? value.hostname : '';
  const hostnameStatus =
    typeof value.status === 'string' ? value.status : 'pending';
  const sslStatus =
    typeof value.ssl?.status === 'string' ? value.ssl.status : 'pending';

  const records: DnsRecord[] = [
    {
      type: 'CNAME',
      name: hostname,
      value: fallbackOrigin,
      purpose: 'routing',
    },
  ];

  // The ownership record only exists while ownership is unproven. Once the
  // hostname is live Cloudflare stops returning it, and showing a stale one
  // invites an institute to delete a record that is now load bearing.
  const ownership = value.ownership_verification;
  if (
    typeof ownership?.name === 'string' &&
    typeof ownership.value === 'string'
  ) {
    records.push({
      type: 'TXT',
      name: ownership.name,
      value: ownership.value,
      purpose: 'ownership',
    });
  } else if (
    typeof value.ssl?.txt_name === 'string' &&
    typeof value.ssl.txt_value === 'string'
  ) {
    records.push({
      type: 'TXT',
      name: value.ssl.txt_name,
      value: value.ssl.txt_value,
      purpose: 'ownership',
    });
  }

  return {
    id: typeof value.id === 'string' ? value.id : '',
    hostname,
    status: deriveStatus(hostnameStatus, sslStatus),
    records,
    message: firstMessage(value),
  };
}

function deriveStatus(
  hostnameStatus: string,
  sslStatus: string,
): CustomHostnameStatus {
  if (hostnameStatus === 'active' && sslStatus === 'active') return 'active';
  if (hostnameStatus === 'moved' || hostnameStatus === 'deleted') {
    return 'failed';
  }
  // Cloudflare reports several distinct flavours of not-yet, and an institute
  // waiting on DNS cannot act differently on any of them.
  if (
    hostnameStatus === 'pending_validation' ||
    hostnameStatus === 'pending_deployment' ||
    hostnameStatus === 'active' ||
    sslStatus === 'pending_validation' ||
    sslStatus === 'pending_deployment' ||
    sslStatus === 'initializing'
  ) {
    return 'verifying';
  }
  if (hostnameStatus === 'blocked' || sslStatus === 'timed_out') {
    return 'failed';
  }

  return 'pending';
}

function firstMessage(value: RawHostname): string | null {
  const validation = value.ssl?.validation_errors?.[0]?.message;
  if (typeof validation === 'string' && validation) return validation;

  const verification = value.verification_errors;
  if (Array.isArray(verification) && typeof verification[0] === 'string') {
    return verification[0];
  }

  return null;
}
