import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  CORNERSTONE as CORNERSTONE_SEED,
  GRACE as GRACE_SEED,
} from '@/db/seed-data';
import {
  cleanupTestIdentities,
  isEmailVerified,
  plantInvitation,
  testEmail,
} from '../helpers/invite';

/**
 * The auth boundary, end to end against a real build.
 *
 * These are the product's central security claims, so they belong in CI rather
 * than in somebody's memory of having checked once: a session must not carry
 * standing from one institute to another, signup must not reveal who holds an
 * account elsewhere, and an account must not come into being without somebody
 * proving control of the address.
 *
 * Host headers are set explicitly rather than by running real DNS, which is
 * exactly how the application sees them behind Cloudflare's tunnel.
 */

const GRACE = 'grace.lamplight.school';
const GRACE_CUSTOM = 'learn.gracebible.test';
const CORNERSTONE = 'cornerstone.lamplight.school';
const APEX = 'lamplight.school';

const PASSWORD = 'correct-horse-battery-staple';

test.afterAll(async () => {
  await cleanupTestIdentities();
});

/**
 * A distinct client address per caller.
 *
 * Sign-in is rate limited to a few attempts per ten seconds per IP, which is a
 * good rule and the reason src/lib/auth/index.ts configures where the address
 * is read from. Every request in this suite arrives from the same loopback
 * socket, so without this the tests share one bucket and start returning 429
 * to each other. Sending the header the platform trusts is also the only way
 * to check the tests are exercising the same path production uses.
 */
function client(): Record<string, string> {
  return {
    'cf-connecting-ip': `203.0.113.${Math.floor(Math.random() * 254) + 1}`,
  };
}

async function signUp(
  request: APIRequestContext,
  host: string,
  email: string,
): Promise<number> {
  const response = await request.post('/api/tenant/sign-up', {
    headers: { host, 'content-type': 'application/json' },
    data: { email, firstName: 'Test', lastName: 'Person' },
  });
  return response.status();
}

/** Creates a real, usable account by walking the activation path over HTTP. */
async function activate(
  request: APIRequestContext,
  host: string,
  tenantId: string,
  email: string,
): Promise<void> {
  const token = await plantInvitation({ tenantId, email });

  const response = await request.post('/api/tenant/activate', {
    headers: { host, 'content-type': 'application/json' },
    data: { token, password: PASSWORD },
  });

  const body = await response.text();
  expect(response.status(), `activation should succeed: ${body}`).toBe(200);
  expect(JSON.parse(body).status).toBe('activated');
}

async function signIn(
  request: APIRequestContext,
  host: string,
  email: string,
): Promise<string | null> {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { host, 'content-type': 'application/json', ...client() },
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
    const email = testEmail('boundary');
    await activate(request, GRACE, GRACE_SEED.id, email);

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
    const email = testEmail('cookie');
    await activate(request, GRACE, GRACE_SEED.id, email);

    const response = await request.post('/api/auth/sign-in/email', {
      headers: { host: GRACE, 'content-type': 'application/json', ...client() },
      data: { email, password: PASSWORD },
    });

    const setCookie = response.headers()['set-cookie'] ?? '';
    expect(setCookie).not.toMatch(/domain=/i);
    expect(setCookie).toMatch(/httponly/i);
  });
});

test.describe('signup creates nothing', () => {
  test('leaves no account behind, so there is no password to test', async ({
    request,
  }) => {
    // This is the whole reason signup was allowed to be turned on. While it
    // created accounts, an attacker could submit an address and then try the
    // password they had just chosen: success meant the address was new. There
    // is now no password and no account, so the attempt cannot distinguish.
    const email = testEmail('nothing');
    expect(await signUp(request, GRACE, email)).toBe(200);

    const attempt = await request.post('/api/auth/sign-in/email', {
      headers: { host: GRACE, 'content-type': 'application/json', ...client() },
      data: { email, password: PASSWORD },
    });
    expect(attempt.ok(), 'signup must not have created a usable account').toBe(
      false,
    );

    const account = await request.get('/account', {
      headers: { host: GRACE, cookie: '' },
    });
    expect(account.status()).toBe(404);
  });

  test('answers identically for new, repeated, and existing addresses', async ({
    request,
  }) => {
    const fresh = testEmail('oracle');

    const responses = [];
    for (const data of [
      { email: fresh, firstName: 'A', lastName: 'B' },
      // Same address again, which hits the resend cooldown internally.
      { email: fresh, firstName: 'A', lastName: 'B' },
      // Seeded, and already a member of both institutes.
      {
        email: 'shared.student@example.test',
        firstName: 'A',
        lastName: 'B',
      },
    ]) {
      responses.push(
        await request.post('/api/tenant/sign-up', {
          headers: { host: GRACE, 'content-type': 'application/json' },
          data,
        }),
      );
    }

    const statuses = responses.map((r) => r.status());
    const bodies = await Promise.all(responses.map((r) => r.text()));

    expect(statuses).toEqual([200, 200, 200]);
    // Byte-identical, so the response cannot be used to tell the cases apart.
    expect(new Set(bodies).size, `bodies differed: ${bodies.join(' | ')}`).toBe(
      1,
    );
  });

  test('answers the same on an institute that has signup closed', async ({
    request,
  }) => {
    // Cornerstone is seeded closed and Grace open. The endpoint must not make
    // that visible, because which institutes accept students is not something
    // the signup endpoint should be reporting on.
    const email = testEmail('closed');

    const open = await request.post('/api/tenant/sign-up', {
      headers: { host: GRACE, 'content-type': 'application/json' },
      data: { email, firstName: 'A', lastName: 'B' },
    });
    const closed = await request.post('/api/tenant/sign-up', {
      headers: { host: CORNERSTONE, 'content-type': 'application/json' },
      data: { email: testEmail('closed2'), firstName: 'A', lastName: 'B' },
    });

    expect(open.status()).toBe(closed.status());
    expect(await open.text()).toBe(await closed.text());
  });

  test('refuses to sign anyone up on a host that serves no institute', async ({
    request,
  }) => {
    const response = await request.post('/api/tenant/sign-up', {
      headers: { host: APEX, 'content-type': 'application/json' },
      data: { email: testEmail('apex'), firstName: 'A', lastName: 'B' },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('activation', () => {
  test('is what creates the account, and proves the address', async ({
    request,
  }) => {
    const email = testEmail('activate');
    await activate(request, GRACE, GRACE_SEED.id, email);

    expect(
      await isEmailVerified(email),
      'following a mailed link is exactly the claim verification makes',
    ).toBe(true);

    const cookie = await signIn(request, GRACE, email);
    expect(cookie, 'the account should now be usable').not.toBeNull();
  });

  test('spends the token once', async ({ request }) => {
    const email = testEmail('replay');
    const token = await plantInvitation({ tenantId: GRACE_SEED.id, email });

    const first = await request.post('/api/tenant/activate', {
      headers: { host: GRACE, 'content-type': 'application/json' },
      data: { token, password: PASSWORD },
    });
    expect(first.status()).toBe(200);

    const second = await request.post('/api/tenant/activate', {
      headers: { host: GRACE, 'content-type': 'application/json' },
      data: { token, password: PASSWORD },
    });
    expect(second.status(), 'a spent link must not work again').toBe(400);
  });

  test('a token is worthless on another institute domain', async ({
    request,
  }) => {
    const email = testEmail('crosstoken');
    const token = await plantInvitation({ tenantId: GRACE_SEED.id, email });

    const wrongHost = await request.post('/api/tenant/activate', {
      headers: { host: CORNERSTONE, 'content-type': 'application/json' },
      data: { token, password: PASSWORD },
    });
    expect(wrongHost.status()).toBe(400);

    // And it still works where it belongs, so the refusal above is isolation
    // rather than a broken token.
    const rightHost = await request.post('/api/tenant/activate', {
      headers: { host: GRACE, 'content-type': 'application/json' },
      data: { token, password: PASSWORD },
    });
    expect(rightHost.status()).toBe(200);
  });

  test('refuses to hand an established account to whoever holds a link', async ({
    request,
  }) => {
    // The address already has an activated account. A second invitation must
    // not be a way to attach to it without signing in, or the design would
    // have traded an information leak for account takeover.
    const email = testEmail('takeover');
    await activate(request, GRACE, GRACE_SEED.id, email);

    const token = await plantInvitation({
      tenantId: CORNERSTONE_SEED.id,
      email,
      role: 'admin',
    });

    const response = await request.post('/api/tenant/activate', {
      headers: { host: CORNERSTONE, 'content-type': 'application/json' },
      data: { token, password: 'a-completely-different-password' },
    });

    expect((await response.json()).status).toBe('sign_in_required');

    // No membership was created, so the anonymous holder of that link got
    // nothing at Cornerstone.
    const cookie = await signIn(request, GRACE, email);
    if (!cookie) throw new Error('sign-in did not set a session cookie');

    const cornerstone = await request.get('/account', {
      headers: { host: CORNERSTONE, cookie },
    });
    expect(cornerstone.status()).toBe(404);
  });
});

test.describe('the signup form', () => {
  test('exists only where the institute opted in', async ({ request }) => {
    const open = await request.get('/sign-up', { headers: { host: GRACE } });
    expect(open.status(), 'Grace is seeded open').toBe(200);

    // Closed is a 404 rather than an explanation. An institute that has not
    // opted in should be no more distinguishable than a path that does not
    // exist.
    const closed = await request.get('/sign-up', {
      headers: { host: CORNERSTONE },
    });
    expect(closed.status(), 'Cornerstone is seeded closed').toBe(404);
  });
});

test.describe('password reset', () => {
  test('answers identically for a real address and an unknown one', async ({
    request,
  }) => {
    // Same rule as signup. A helpful "no account with that address" would tell
    // anybody who asks whether a given person studies on this platform.
    const real = testEmail('reset');
    await activate(request, GRACE, GRACE_SEED.id, real);

    const known = await request.post('/api/tenant/reset-request', {
      headers: { host: GRACE, 'content-type': 'application/json' },
      data: { email: real },
    });
    const unknown = await request.post('/api/tenant/reset-request', {
      headers: { host: GRACE, 'content-type': 'application/json' },
      data: { email: testEmail('nobody') },
    });

    expect(known.status()).toBe(unknown.status());
    expect(await known.text()).toBe(await unknown.text());
  });

  test('will not reset anything on a host that serves no institute', async ({
    request,
  }) => {
    const response = await request.post('/api/tenant/reset-request', {
      headers: { host: APEX, 'content-type': 'application/json' },
      data: { email: testEmail('apexreset') },
    });
    expect(response.status()).toBe(404);
  });

  test('offers the form on every institute', async ({ request }) => {
    // Unlike signup, this is not something an institute opts into. Anyone with
    // an account needs a way back into it.
    for (const host of [GRACE, CORNERSTONE]) {
      const response = await request.get('/reset-password', {
        headers: { host },
      });
      expect(response.status(), `${host} should serve the form`).toBe(200);
    }
  });
});
