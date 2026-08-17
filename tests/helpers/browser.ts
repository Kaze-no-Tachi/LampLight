import type { Page } from '@playwright/test';

/**
 * Signing in the way a person does.
 *
 * The rest of the browser suite drives HTTP directly with explicit Host
 * headers, which is right for asserting what an endpoint answers. These tests
 * are about what somebody experiences, so they use a real browser against the
 * institute's real hostname: the Origin header is real, the cookie is
 * host-only for real, and the canonical redirect applies for real.
 *
 * The hostnames resolve because playwright.config.ts starts Chromium with
 * host-resolver-rules pointing them at the local server.
 */

export const GRACE_HOST = 'grace.lamplight.school';
export const CORNERSTONE_HOST = 'cornerstone.lamplight.school';

/** Fixture accounts. The seed gives every one of them this password. */
export const SEED_PASSWORD = 'lamplight-demo-password';

export const PEOPLE = {
  admin: 'admin@gracebible.test',
  instructor: 'instructor@gracebible.test',
  student: 'student1@gracebible.test',
  otherStudent: 'student2@gracebible.test',
} as const;

export function url(host: string, path = '/'): string {
  const port = process.env.PORT ?? '3000';
  return `http://${host}:${port}${path}`;
}

/**
 * Signs in, and proves a session actually exists afterwards.
 *
 * THE HOLE THIS CLOSES. The first version waited for the URL to become
 * /account and called that success. It is not: the sign-in form navigates
 * whenever the endpoint answers 200, and the endpoint answers 200 while the
 * browser is quietly discarding the cookie it set. That happened for real, and
 * every gated page then rendered its 404 for a signed-out visitor, so nine
 * tests failed with locator timeouts that pointed at the pages rather than at
 * the sign-in they all shared.
 *
 * Asking the server who it thinks we are costs one request and cannot be
 * satisfied by a redirect.
 */
export async function signIn(
  page: Page,
  email: string,
  host: string = GRACE_HOST,
): Promise<void> {
  await page.goto(url(host, '/sign-in'));
  await page.locator('input[name=email]').fill(email);
  await page.locator('input[name=password]').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(`**${host}:*/account`, { timeout: 15_000 });

  const session = await page.evaluate(async () => {
    const response = await fetch('/api/auth/get-session', {
      cache: 'no-store',
    });
    return (await response.json()) as { user?: { email?: string } } | null;
  });

  if (session?.user?.email !== email) {
    throw new Error(
      `signed in as ${email} and reached /account, but the server reports ` +
        `no session (${JSON.stringify(session)}). The cookie was not kept: ` +
        'check that the server under test has INSECURE_HTTP set, since a ' +
        'production build marks the session cookie Secure and this suite ' +
        'speaks http.',
    );
  }
}

/** What the media element is doing, which is the only honest playback check. */
export async function audioState(page: Page): Promise<{
  paused: boolean;
  position: number;
  duration: number | null;
} | null> {
  return page.evaluate(() => {
    const element = document.querySelector('audio');
    if (!element) return null;
    return {
      paused: element.paused,
      position: Number(element.currentTime.toFixed(1)),
      duration: Number.isFinite(element.duration) ? element.duration : null,
    };
  });
}
