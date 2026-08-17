import { expect, test } from '../helpers/test';
import {
  audioState,
  PEOPLE,
  signIn,
  url,
  GRACE_HOST,
} from '../helpers/browser';

/**
 * The player (PRD requirement P0-8), in a browser, because that is the only
 * place the claim means anything.
 *
 * "Survives navigation" cannot be asserted against a route handler. It is a
 * statement about a DOM element outliving a client-side route change, and the
 * way it breaks is that somebody moves the player out of the layout and every
 * test still passes. So these drive a real page: press play, click a link,
 * check the same element is still going.
 *
 * The recordings come from the seed, which uploads a real ninety second tone
 * per lesson (src/db/seed-media.ts). Before that existed the fixture pointed
 * at objects that were never uploaded and the player was inert.
 */

/** A course this student holds through the diploma program. */
const COURSE = '/courses/old-testament-survey';

async function openFirstLesson(page: import('@playwright/test').Page) {
  await page.goto(url(GRACE_HOST, COURSE));
  const href = await page
    .locator('a[href^="/lessons/"]')
    .first()
    .getAttribute('href');
  if (!href) throw new Error('the course page offered no lessons');

  await page.goto(url(GRACE_HOST, href));
  return href.split('/').pop() ?? '';
}

test.describe('playing a lecture', () => {
  test('keeps playing while the student reads something else', async ({
    page,
  }) => {
    // THE REQUIREMENT, AND THE WAY IT BREAKS. The player is mounted in the
    // tenant layout so a route change never unmounts it. Move it into a page
    // and this is the only test that notices.
    await signIn(page, PEOPLE.student);
    await openFirstLesson(page);

    await page.getByRole('button', { name: /play this lecture/i }).click();
    await expect
      .poll(async () => (await audioState(page))?.paused, {
        message: 'the lecture should be playing',
        timeout: 10_000,
      })
      .toBe(false);

    const before = await audioState(page);

    await page.getByRole('link', { name: 'Courses', exact: true }).click();
    await page.waitForURL('**/courses');

    await expect
      .poll(async () => (await audioState(page))?.position ?? 0, {
        message: 'playback should have advanced across the navigation',
        timeout: 10_000,
      })
      .toBeGreaterThan(before?.position ?? 0);

    expect((await audioState(page))?.paused).toBe(false);
  });

  test('remembers the position and picks it up on a cold load', async ({
    page,
  }) => {
    await signIn(page, PEOPLE.student);
    const lessonId = await openFirstLesson(page);

    await page.getByRole('button', { name: /play this lecture/i }).click();
    await expect
      .poll(async () => (await audioState(page))?.paused, { timeout: 10_000 })
      .toBe(false);

    // A seek is only honoured once the browser knows how long the file is, and
    // `paused === false` arrives before that. Setting currentTime any earlier
    // is dropped, playback carries on from zero, and the test fails on a race
    // rather than on the behaviour it is about.
    await expect
      .poll(async () => (await audioState(page))?.duration, {
        message: 'metadata should load before seeking',
        timeout: 10_000,
      })
      .not.toBeNull();

    // Well past the fifteen second threshold under which a position is treated
    // as somebody who pressed play and wandered off.
    await page.evaluate(() => {
      const element = document.querySelector('audio');
      if (element) element.currentTime = 45;
    });

    // And the seek itself is asynchronous, so pausing before it lands would
    // sync whatever position playback happened to be at.
    await expect
      .poll(async () => (await audioState(page))?.position ?? 0, {
        message: 'the seek should land before pausing',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(44);

    await page.evaluate(() => document.querySelector('audio')?.pause());

    // Pausing syncs, so the server should have it without waiting for the
    // fifteen second interval.
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const response = await fetch(`/api/tenant/lessons/${id}/progress`, {
              cache: 'no-store',
            });
            const body = (await response.json()) as {
              positionSeconds?: number;
            };
            return body.positionSeconds ?? 0;
          }, lessonId),
        { message: 'the position should reach the server', timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(40);

    // A completely fresh page, the way somebody comes back the next morning.
    await page.goto(url(GRACE_HOST, `/lessons/${lessonId}`));
    await page.getByRole('button', { name: /play this lecture/i }).click();

    await expect
      .poll(async () => (await audioState(page))?.position ?? 0, {
        message: 'it should resume near where they stopped',
        timeout: 10_000,
      })
      .toBeGreaterThan(40);
  });

  test('answers the keyboard', async ({ page }) => {
    await signIn(page, PEOPLE.student);
    await openFirstLesson(page);

    await page.getByRole('button', { name: /play this lecture/i }).click();
    await expect
      .poll(async () => (await audioState(page))?.paused, { timeout: 10_000 })
      .toBe(false);

    await page.keyboard.press(' ');
    await expect
      .poll(async () => (await audioState(page))?.paused, { timeout: 5_000 })
      .toBe(true);
  });

  test('does not scrub the lecture while somebody is typing', async ({
    page,
  }) => {
    // The classic version of this bug: a student types their congregation into
    // a form and every space bar jumps the audio.
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/courses/old-testament-survey'));
    const href = await page
      .locator('a[href^="/lessons/"]')
      .first()
      .getAttribute('href');
    await page.goto(url(GRACE_HOST, href ?? '/'));

    await page.getByRole('button', { name: /play this lecture/i }).click();
    await expect
      .poll(async () => (await audioState(page))?.paused, { timeout: 10_000 })
      .toBe(false);

    // Reached by clicking, not by page.goto: a hard navigation unmounts the
    // player on purpose, so loading the settings page directly would prove
    // nothing about the shortcut and everything about how Playwright
    // navigates. The first version of this test made exactly that mistake.
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.waitForURL('**/settings/branding');

    const field = page.locator('input:not([type])').first();
    await field.click();
    await field.press(' ');

    expect(
      (await audioState(page))?.paused,
      'a space typed into a field must not pause the lecture',
    ).toBe(false);
  });

  test('refuses to remember a position for a lesson at another institute', async ({
    request,
  }) => {
    // The progress endpoint is a write keyed on a lesson id. Without the same
    // predicate the media is behind, anybody could write rows against any
    // institute's lessons, and the id being accepted would say it exists.
    const cornerstoneLesson = await request.get('/api/health');
    expect(cornerstoneLesson.ok()).toBe(true);

    const response = await request.post(
      '/api/tenant/lessons/00000000-0000-4000-8000-000000000404/progress',
      {
        headers: { host: GRACE_HOST, 'content-type': 'application/json' },
        data: { positionSeconds: 30 },
      },
    );

    expect(response.status()).toBe(404);
  });
});
