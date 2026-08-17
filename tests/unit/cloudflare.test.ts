import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudflareTransport } from '@/lib/cloudflare/custom-hostnames';

/**
 * The Cloudflare client, driven by recorded response shapes.
 *
 * No credentials and no network. What is worth testing here is not that fetch
 * was called, it is the two pieces of judgement in the file: when a hostname
 * counts as live, and which failures an institute can act on versus which are
 * the operator's problem.
 */

const ENV = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/lamplight',
  DATABASE_ADMIN_URL: 'postgres://admin:pw@localhost:5432/lamplight',
  CLOUDFLARE_ZONE_ID: 'zone-1',
  CLOUDFLARE_API_TOKEN: 'token-1',
  CLOUDFLARE_SAAS_FALLBACK_ORIGIN: 'origin.lamplight.school',
} as const;

function ok(result: unknown) {
  return { status: 200, json: { success: true, result } };
}

function failure(status: number, errors: { code: number; message: string }[]) {
  return { status, json: { success: false, errors } };
}

/**
 * A hostname a few seconds after creation, transcribed from a real response.
 *
 * The previous version of this fixture had ownership_verification and no
 * ssl.txt_name, because that is what the code assumed, and the code passed
 * against it while being wrong. Cloudflare sends both records at once. The
 * shape below came from scripts/cf-probe.ts against a live zone.
 */
const PENDING_VALIDATION = {
  id: 'cf-1',
  hostname: 'learn.institute.edu',
  status: 'pending',
  ownership_verification: {
    type: 'txt',
    name: '_cf-custom-hostname.learn.institute.edu',
    value: 'ownership-token',
  },
  ssl: {
    status: 'pending_validation',
    txt_name: '_acme-challenge.learn.institute.edu',
    txt_value: 'acme-token',
  },
};

/**
 * The same hostname at the instant it is created.
 *
 * Cloudflare has not issued the certificate record yet: ssl.status is
 * "initializing" and there is no txt_name at all. Kept as its own fixture
 * because the settings page has to handle a record list that is incomplete
 * rather than final.
 */
const JUST_CREATED = {
  id: 'cf-1',
  hostname: 'learn.institute.edu',
  status: 'pending',
  ownership_verification: {
    type: 'txt',
    name: '_cf-custom-hostname.learn.institute.edu',
    value: 'ownership-token',
  },
  ssl: {
    id: 'ssl-1',
    type: 'dv',
    method: 'txt',
    status: 'initializing',
    certificate_authority: 'google',
  },
};

beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('creating a custom hostname', () => {
  it('returns all three records the institute has to create', async () => {
    // THE BUG THIS PREVENTS, AND IT SHIPPED.
    //
    // These two TXT records were written as an if/else, so the ownership one
    // won for the whole pre-verification window and the certificate one was
    // never shown. An institute would create everything on screen, and the
    // certificate would never issue, because the record that unblocks it was
    // not on screen. The unit tests all passed: the fake agreed with the bug.
    const transport: CloudflareTransport = async () => ok(PENDING_VALIDATION);
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    const result = await createCustomHostnameClient(transport).create(
      'learn.institute.edu',
    );

    expect(result.records).toEqual([
      {
        type: 'CNAME',
        name: 'learn.institute.edu',
        value: 'origin.lamplight.school',
        purpose: 'routing',
      },
      {
        type: 'TXT',
        name: '_cf-custom-hostname.learn.institute.edu',
        value: 'ownership-token',
        purpose: 'ownership',
      },
      {
        type: 'TXT',
        name: '_acme-challenge.learn.institute.edu',
        value: 'acme-token',
        purpose: 'certificate',
      },
    ]);
  });

  it('copes with the certificate record not existing yet', async () => {
    // Cloudflare answers "initializing" with no record at creation and issues
    // one seconds later, so the list is briefly incomplete rather than wrong.
    // The settings page reads the absence of a certificate record to say so.
    const transport: CloudflareTransport = async () => ok(JUST_CREATED);
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    const result = await createCustomHostnameClient(transport).create(
      'learn.institute.edu',
    );

    expect(result.records.map((record) => record.purpose)).toEqual([
      'routing',
      'ownership',
    ]);
    expect(result.status).toBe('verifying');
  });

  it('asks for TXT validation, not HTTP', async () => {
    // HTTP validation needs the hostname already pointing at us. It does not
    // yet, and the institute's existing site has to keep serving until they
    // choose to move the CNAME.
    const seen: unknown[] = [];
    const transport: CloudflareTransport = async (request) => {
      seen.push(request.body);
      return ok(PENDING_VALIDATION);
    };
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    await createCustomHostnameClient(transport).create('learn.institute.edu');

    expect(seen[0]).toMatchObject({ ssl: { method: 'txt', type: 'dv' } });
  });
});

describe('deciding when a hostname is actually live', () => {
  it('is not active until the certificate is too', async () => {
    // THE BUG THIS PREVENTS: marking the domain verified on the hostname
    // status alone means resolution starts serving it while Cloudflare is
    // still issuing the certificate, so every visitor gets a TLS error on a
    // domain our own database says is fine.
    const transport: CloudflareTransport = async () =>
      ok({
        ...PENDING_VALIDATION,
        status: 'active',
        ssl: { status: 'pending_validation' },
      });
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    const result = await createCustomHostnameClient(transport).get('cf-1');
    expect(result.status).toBe('verifying');
  });

  it('is active when both halves are', async () => {
    const transport: CloudflareTransport = async () =>
      ok({
        id: 'cf-1',
        hostname: 'learn.institute.edu',
        status: 'active',
        ssl: { status: 'active' },
      });
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    const result = await createCustomHostnameClient(transport).get('cf-1');
    expect(result.status).toBe('active');
  });

  it('drops the ownership record once there is nothing left to prove', async () => {
    // Showing a stale TXT record invites an institute to keep a record that
    // Cloudflare no longer returns, or worse, to delete the CNAME instead.
    const transport: CloudflareTransport = async () =>
      ok({
        id: 'cf-1',
        hostname: 'learn.institute.edu',
        status: 'active',
        ssl: { status: 'active' },
      });
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    const result = await createCustomHostnameClient(transport).get('cf-1');
    expect(result.records.map((record) => record.type)).toEqual(['CNAME']);
  });

  it('surfaces why Cloudflare is unhappy', async () => {
    const transport: CloudflareTransport = async () =>
      ok({
        ...PENDING_VALIDATION,
        ssl: {
          status: 'pending_validation',
          validation_errors: [{ message: 'TXT record not found' }],
        },
      });
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    const result = await createCustomHostnameClient(transport).get('cf-1');
    expect(result.message).toBe('TXT record not found');
  });
});

describe('failures are classified by who can fix them', () => {
  it('separates a taken hostname from a bad token', async () => {
    const { createCustomHostnameClient, CloudflareError } =
      await import('@/lib/cloudflare/custom-hostnames');

    const taken: CloudflareTransport = async () =>
      failure(400, [{ code: 1406, message: 'Custom hostname already exists' }]);
    await expect(
      createCustomHostnameClient(taken).create('learn.institute.edu'),
    ).rejects.toMatchObject({ kind: 'taken' });

    const badToken: CloudflareTransport = async () => failure(403, []);
    await expect(
      createCustomHostnameClient(badToken).create('learn.institute.edu'),
    ).rejects.toMatchObject({ kind: 'auth' });

    // The distinction is the point: one sends the institute to their DNS
    // provider, the other is the platform operator's to fix, and telling an
    // institute the wrong one wastes a day of somebody's week.
    expect(new CloudflareError('taken', 'x').kind).not.toBe('auth');
  });

  it('treats a transport failure as temporary rather than as a rejection', async () => {
    const transport: CloudflareTransport = async () => {
      throw new Error('socket hang up');
    };
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    await expect(
      createCustomHostnameClient(transport).get('cf-1'),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('treats a Cloudflare 500 as temporary too', async () => {
    const transport: CloudflareTransport = async () => ({
      status: 502,
      json: {},
    });
    const { createCustomHostnameClient } =
      await import('@/lib/cloudflare/custom-hostnames');

    await expect(
      createCustomHostnameClient(transport).get('cf-1'),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
