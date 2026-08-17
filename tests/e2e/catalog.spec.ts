import { GRACE_HOST, PEOPLE, signIn, url } from '../helpers/browser';
import { expect, test } from '../helpers/test';

/**
 * Building a catalogue, which is where a real institute starts.
 *
 * THE GAP THIS COVERS. Everything downstream of a course could be edited and
 * nothing could be created: courses, programs, and instructor assignments
 * existed only in the seed script. A freshly provisioned institute reached
 * /teach, was told an admin could assign them to a course, and had no course
 * to assign and no way to make one. Nothing failed, so nothing caught it until
 * somebody tried to use the product.
 *
 * Each test writes as the admin and reads as somebody else, because "the form
 * said Created" and "a student can see it" are different claims.
 */

const NAME = `Church History ${Date.now()}`;
const SLUG_HINT = 'input[placeholder*="Web address"]';

async function openCatalog(page: import('@playwright/test').Page) {
  await page.goto(url(GRACE_HOST, '/settings/catalog'));
}

test.describe('an admin building a catalogue', () => {
  test('creates a course, publishes it, and a visitor can find it', async ({
    page,
    context,
  }) => {
    await signIn(page, PEOPLE.admin);
    await openCatalog(page);

    await page.locator('input[placeholder="Old Testament Survey"]').fill(NAME);
    await page.locator(SLUG_HINT).first().fill('church-history-test');
    await page.getByRole('button', { name: /create course/i }).click();
    await expect(page.getByText(/Course created/i)).toBeVisible();

    const row = page.locator('li', { hasText: NAME }).first();
    await expect(row).toContainText('not published');
    await expect(row).toContainText('0 lessons');

    // Unpublished means invisible, which is the half that is easy to get wrong.
    const visitor = await context.newPage();
    await visitor.goto(url(GRACE_HOST, '/courses'));
    await expect(visitor.locator('main')).not.toContainText(NAME);

    await row.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByText('Published.')).toBeVisible();

    await visitor.reload();
    await expect(visitor.locator('main')).toContainText(NAME);

    // And withdrawing takes it back out, which is the half everybody forgets.
    await page.reload();
    await page
      .locator('li', { hasText: NAME })
      .first()
      .getByRole('button', { name: /^Withdraw$/ })
      .click();
    await expect(page.getByText(/Withdrawn/i)).toBeVisible();

    await visitor.reload();
    await expect(visitor.locator('main')).not.toContainText(NAME);
  });

  test('refuses a second course on the same web address', async ({ page }) => {
    // Two courses sharing a slug means one of them is unreachable, and the
    // database constraint would report it as an unhandled error rather than
    // as something the person can fix.
    await signIn(page, PEOPLE.admin);
    await openCatalog(page);

    await page
      .locator('input[placeholder="Old Testament Survey"]')
      .fill('Old Testament Survey');
    await page.getByRole('button', { name: /create course/i }).click();

    await expect(page.getByText(/already uses the address/i)).toBeVisible();
  });

  test('assigning an instructor is what puts it on their teaching list', async ({
    page,
    browser,
  }) => {
    await signIn(page, PEOPLE.admin);
    await openCatalog(page);

    const title = `Homiletics ${Date.now()}`;
    await page.locator('input[placeholder="Old Testament Survey"]').fill(title);
    await page.getByRole('button', { name: /create course/i }).click();
    await expect(page.getByText(/Course created/i)).toBeVisible();

    const row = page.locator('li', { hasText: title }).first();
    await expect(row).toContainText('Nobody yet');

    // By value rather than label: the option reads "Name (email)" and
    // selectOption matches labels exactly, with no regex.
    const option = row
      .locator('select option')
      .filter({ hasText: 'instructor@' })
      .first();
    const value = await option.getAttribute('value');
    if (!value) throw new Error('the instructor was not offered as an option');
    await row.locator('select').selectOption(value);
    await row.getByRole('button', { name: /^Assign$/ }).click();
    await expect(page.getByText('Assigned.')).toBeVisible();

    // Their own session, not the admin's view of it.
    const theirs = await browser.newContext();
    const theirPage = await theirs.newPage();
    await signIn(theirPage, PEOPLE.instructor);
    await theirPage.goto(url(GRACE_HOST, '/teach'));
    await expect(theirPage.locator('main')).toContainText(title);

    await theirs.close();
  });

  test('is not something an instructor can reach', async ({ page }) => {
    // Deciding what the institute teaches, and who teaches it, is not an
    // instructor's call even though editing the content is.
    await signIn(page, PEOPLE.instructor);

    const response = await page.goto(url(GRACE_HOST, '/settings/catalog'));
    expect(response?.status()).toBe(404);
  });
});

test.describe('every admin screen is reachable', () => {
  test('from the header, without knowing the URL', async ({ page }) => {
    // Domains and Signup were built and linked from nowhere. A screen you can
    // only reach by typing its path is a screen that does not exist for the
    // person who needs it.
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/account'));

    for (const [label, path] of [
      ['Catalogue', '/settings/catalog'],
      ['People', '/settings/people'],
      ['Branding', '/settings/branding'],
      ['Domains', '/settings/domains'],
      ['Signup', '/settings/signup'],
    ] as const) {
      const link = page.getByRole('link', { name: label, exact: true });
      await expect(link, `${label} should be in the header`).toBeVisible();
      expect(await link.getAttribute('href')).toBe(path);
    }
  });

  test('and those links are not shown to a student', async ({ page }) => {
    await signIn(page, PEOPLE.student);
    await page.goto(url(GRACE_HOST, '/account'));

    for (const label of ['Catalogue', 'Domains', 'Signup'] as const) {
      await expect(
        page.getByRole('link', { name: label, exact: true }),
      ).toHaveCount(0);
    }
  });
});

test.describe('programs', () => {
  test('can be published, which is the only way anybody sees one', async ({
    page,
    context,
  }) => {
    // THE BUG THIS COVERS. The catalogue shipped with a publish button for
    // courses and none for programs. The public list filters on published, so
    // every program an institute created was invisible for ever, with no error
    // and nothing to click. Programs were reported as "not showing up
    // anywhere"; they showed up nowhere because they could not be published.
    await signIn(page, PEOPLE.admin);
    await openCatalog(page);

    const title = `Diploma ${Date.now()}`;
    await page
      .locator('input[placeholder="Certificate in Ministry"]')
      .fill(title);
    await page.getByRole('button', { name: /create program/i }).click();
    await expect(page.getByText(/Program created/i)).toBeVisible();

    const row = page.locator('li', { hasText: title }).first();
    await expect(row).toContainText('not published');

    const visitor = await context.newPage();
    await visitor.goto(url(GRACE_HOST, '/courses'));
    await expect(visitor.locator('main')).not.toContainText(title);

    await row.getByRole('button', { name: /^Publish$/ }).click();
    await expect(page.getByText('Published.')).toBeVisible();

    await visitor.reload();
    await expect(visitor.locator('main')).toContainText(title);
  });
});

test.describe('signing out', () => {
  test('is possible, and actually ends the session', async ({ page }) => {
    // There was no sign-out control anywhere. On the shared office machine
    // this product is used from, that is not a power user's problem.
    await signIn(page, PEOPLE.student);
    await page.goto(url(GRACE_HOST, '/account'));

    await page.getByRole('button', { name: /^Sign out$/ }).click();

    // The server, first and foremost. Asserting the header was the original
    // mistake: the home page offers its own Sign in link, so that assertion
    // passed while the session was still live.
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/auth/get-session', {
        cache: 'no-store',
      });
      return (await response.json()) as { user?: unknown } | null;
    });
    expect(session?.user).toBeFalsy();

    // And a gated page is gated again.
    const response = await page.goto(url(GRACE_HOST, '/account'));
    expect(response?.status()).toBe(404);
  });
});
