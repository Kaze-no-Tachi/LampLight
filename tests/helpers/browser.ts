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

/**
 * The authoring flows, in one place, because the reskin moved all three of
 * them and four specs drove each one by hand.
 *
 * Creating a course and adding a lesson are now pages rather than an inline
 * form and a modal (mockups 7 and 8). That is a shape change, not a selector
 * change: both end somewhere new, and every caller needs the same two waits.
 * Written here once so the next move only breaks one file.
 */

/** Creates a course through the new-course screen. Returns its id. */
export async function createCourse(
  page: Page,
  title: string,
  options: { slug?: string } = {},
): Promise<string> {
  await page.goto(url(GRACE_HOST, '/teach/courses/new'));
  await page.locator('input[placeholder="The Minor Prophets"]').fill(title);

  if (options.slug) {
    // The address is derived from the title unless somebody asks for the
    // field, which is the whole point of that disclosure.
    await page
      .getByRole('button', { name: /set the address yourself/i })
      .click();
    await page.locator('input[aria-label="Web address"]').fill(options.slug);
  }

  await page.getByRole('button', { name: /^Create course$/ }).click();

  // Lands in the course's own settings (round 2 decision), which is also where
  // its id first appears in a URL.
  //
  // MATCHED ON THE ID, NOT ON A GLOB. `**/teach/courses/*` is satisfied by
  // /teach/courses/new, which is the page this function starts on, so the wait
  // returned immediately and every caller then drove the new-course form
  // believing it was on course settings. Four tests failed that way, all of
  // them reporting whatever the new-course page happened to have under the
  // cursor.
  await page.waitForURL(/\/teach\/courses\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id) throw new Error(`created "${title}" but landed on ${page.url()}`);
  return id;
}

/**
 * Adds a lesson to a course and comes back to its settings.
 *
 * Creating a lesson opens its editor, because the recording and the notes are
 * the next thing anybody does. Tests that are asserting about the course's own
 * list want to be back on it, so this returns there and hands back the lesson
 * id it passed through.
 */
export async function addLesson(
  page: Page,
  courseId: string,
  title: string,
  options: { openToEveryone?: boolean } = {},
): Promise<string> {
  await page.goto(url(GRACE_HOST, `/teach/courses/${courseId}/lessons/new`));
  await page
    .locator('input[placeholder="Hosea and a marriage as a sign"]')
    .fill(title);

  if (options.openToEveryone) {
    await page.getByText('Open to everyone', { exact: true }).click();
  }

  await page.getByRole('button', { name: /^Create lesson$/ }).click();
  await page.waitForURL(/\/teach\/lessons\/[0-9a-f-]{36}$/);
  const lessonId = new URL(page.url()).pathname.split('/').pop() ?? '';

  await page.goto(url(GRACE_HOST, `/teach/courses/${courseId}`));
  return lessonId;
}

/** Opens a named course's settings from the teaching list. */
export async function openCourseSettings(
  page: Page,
  courseTitle: string,
): Promise<void> {
  await page.goto(url(GRACE_HOST, '/teach'));
  await page
    .locator('[data-testid="course-card"]', { hasText: courseTitle })
    .first()
    .getByRole('link', { name: /^Course settings$/ })
    .click();
  await page.waitForURL(/\/teach\/courses\/[0-9a-f-]{36}$/);
}
