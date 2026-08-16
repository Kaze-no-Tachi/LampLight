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

/** A hostname mid-setup: ownership not yet proven, no certificate. */
const PENDING_VALIDATION = {
  id: 'cf-1',
  hostname: 'learn.institute.edu',
  status: 'pending_validation',
  ownership_verification: {
    type: 'txt',
    name: '_cf-custom-hostname.learn.institute.edu',
    value: 'ownership-token',
  },
  ssl: { status: 'pending_validation' },
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
  it('returns both records the institute has to create', async () => {
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
    ]);
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
