import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * The auth boundary, end to end against a real build.
 *
 * These assertions were previously made by hand against a running server. They
 * are the product's central security claims, so they belong in CI: a session
 * must not carry standing from one institute to another, and signup must not
 * be usable to discover who holds an account elsewhere.
 *
 * Host headers are set explicitly rather than by running real DNS, which is
 * exactly how the application sees them behind Cloudflare's tunnel.
 */

const GRACE = 'grace.lamplight.school';
const GRACE_CUSTOM = 'learn.gracebible.test';
const CORNERSTONE = 'cornerstone.lamplight.school';
const APEX = 'lamplight.school';

const PASSWORD = 'correct-horse-battery-staple';

function unique(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function signUp(
  request: APIRequestContext,
  host: string,
  email: string,
): Promise<number> {
  const response = await request.post('/api/tenant/sign-up', {
    headers: { host, 'content-type': 'application/json' },
    data: { email, password: PASSWORD, name: 'Test Person' },
  });
  return response.status();
}

async function signIn(
  request: APIRequestContext,
  host: string,
  email: string,
): Promise<string | null> {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { host, 'content-type': 'application/json' },
    data: { email, password: PASSWORD },
  });

  const raw = response.headers()['set-cookie'];
  if (!raw) return null;
  return raw.split('\n')[0]?.split(';')[0] ?? null;
}

test.describe('tenant resolution', () => {
  test('resolves each institute and refuses everything else identically', async ({
    request,
  }) => {
    for (const host of [GRACE, GRACE_CUSTOM, CORNERSTONE]) {
      const response = await request.get('/', { headers: { host } });
      expect(response.status(), `${host} should resolve`).toBe(200);
    }

    // Unverified domain, unknown domain, apex lookalike, and an unclaimed
    // slug must be indistinguishable, or the institute list is enumerable.
    for (const host of [
      'learn.cornerstone.test',
      'totally-unknown.example.com',
      'evil-lamplight.school',
      'nosuchtenant.lamplight.school',
    ]) {
      const response = await request.get('/', { headers: { host } });
      expect(response.status(), `${host} must 404`).toBe(404);
    }
  });

  test('keeps the superadmin console off institute domains', async ({
    request,
  }) => {
    // Not 403: a tenant admin must not be able to tell that the console exists.
    for (const host of [GRACE, CORNERSTONE]) {
      const response = await request.get('/superadmin', { headers: { host } });
      expect(response.status()).toBe(404);
    }
  });
});

test.describe('a session does not cross institutes', () => {
  test('grants access only where the member has a membership', async ({
    request,
  }) => {
    const email = unique('boundary');
    expect(await signUp(request, GRACE, email)).toBe(200);

    const cookie = await signIn(request, GRACE, email);
    // Thrown rather than asserted, so the type narrows for the calls below
    // without a non-null assertion.
    if (!cookie) throw new Error('sign-in did not set a session cookie');

    // Same session, three hosts. Two belong to the institute this person
    // joined, one does not.
    const grace = await request.get('/account', {
      headers: { host: GRACE, cookie },
    });
    expect(grace.status(), 'own institute, platform subdomain').toBe(200);

    const graceCustom = await request.get('/account', {
      headers: { host: GRACE_CUSTOM, cookie },
    });
    expect(graceCustom.status(), 'own institute, custom domain').toBe(200);

    const cornerstone = await request.get('/account', {
      headers: { host: CORNERSTONE, cookie },
    });
    expect(
      cornerstone.status(),
      'the session is valid, the membership is not: must be 404, not 403',
    ).toBe(404);
  });

  test('sets a host-only cookie, so it is never sent to another institute', async ({
    request,
  }) => {
    const email = unique('cookie');
    await signUp(request, GRACE, email);

    const response = await request.post('/api/auth/sign-in/email', {
      headers: { host: GRACE, 'content-type': 'application/json' },
      data: { email, password: PASSWORD },
    });

    const setCookie = response.headers()['set-cookie'] ?? '';
    expect(setCookie).not.toMatch(/domain=/i);
    expect(setCookie).toMatch(/httponly/i);
  });
});

test.describe('signup is not an account existence oracle', () => {
  test('answers identically for new, repeated, and foreign addresses', async ({
    request,
  }) => {
    const fresh = unique('oracle');

    const responses = await Promise.all([
      request.post('/api/tenant/sign-up', {
        headers: { host: GRACE, 'content-type': 'application/json' },
        data: { email: fresh, password: PASSWORD, name: 'A' },
      }),
      request.post('/api/tenant/sign-up', {
        headers: { host: GRACE, 'content-type': 'application/json' },
        data: { email: fresh, password: PASSWORD, name: 'A' },
      }),
      // Seeded, and a member of both institutes already.
      request.post('/api/tenant/sign-up', {
        headers: { host: GRACE, 'content-type': 'application/json' },
        data: {
          email: 'shared.student@example.test',
          password: PASSWORD,
          name: 'A',
        },
      }),
    ]);

    const statuses = responses.map((r) => r.status());
    const bodies = await Promise.all(responses.map((r) => r.text()));

    expect(statuses).toEqual([200, 200, 200]);
    // Byte-identical, so the response cannot be used to tell the cases apart.
    expect(new Set(bodies).size, `bodies differed: ${bodies.join(' | ')}`).toBe(
      1,
    );
  });

  test('refuses to sign anyone up on a host that serves no institute', async ({
    request,
  }) => {
    const response = await request.post('/api/tenant/sign-up', {
      headers: { host: APEX, 'content-type': 'application/json' },
      data: { email: unique('apex'), password: PASSWORD, name: 'A' },
    });
    expect(response.status()).toBe(404);
  });
});
