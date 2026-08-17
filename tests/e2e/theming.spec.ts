import { expect, test } from '../helpers/test';
import {
  CORNERSTONE_HOST,
  GRACE_HOST,
  PEOPLE,
  signIn,
  url,
} from '../helpers/browser';

/**
 * Per-tenant theming (PRD requirement P0-12).
 *
 * Two claims worth asserting in a browser. The first is that two institutes on
 * one deployment genuinely look different, which is a statement about what
 * arrives in the document rather than about what a function returns. The
 * second is the security property: no value an institute admin types can
 * produce anything but a colour, because the tokens are a fixed list and the
 * values are re-serialised from parsed numbers.
 */

/** Reads a resolved custom property the way the page actually uses it. */
async function token(
  page: import('@playwright/test').Page,
  name: string,
): Promise<string> {
  return page.evaluate(
    (property) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(property)
        .trim(),
    name,
  );
}

test.describe('two institutes, one deployment', () => {
  test('do not look the same', async ({ page }) => {
    await page.goto(url(GRACE_HOST));
    const grace = {
      primary: await token(page, '--primary'),
      background: await token(page, '--background'),
      radius: await token(page, '--radius'),
    };

    await page.goto(url(CORNERSTONE_HOST));
    const cornerstone = {
      primary: await token(page, '--primary'),
      background: await token(page, '--background'),
      radius: await token(page, '--radius'),
    };

    expect(grace.primary).not.toBe('');
    expect(grace.primary).not.toBe(cornerstone.primary);
    expect(grace.background).not.toBe(cornerstone.background);
    expect(grace.radius).not.toBe(cornerstone.radius);
  });

  test('each carries its own words and its own name', async ({ page }) => {
    await page.goto(url(GRACE_HOST));
    await expect(page.locator('header')).toContainText('Grace Bible Institute');
    await expect(page.locator('main')).toContainText(
      /Theological training from Grace Bible Institute/i,
    );

    await page.goto(url(CORNERSTONE_HOST));
    await expect(page.locator('header')).toContainText(
      'Cornerstone Baptist Institute',
    );
  });
});

test.describe('an admin changing the brand', () => {
  test('changes what a visitor sees, without a deploy', async ({
    page,
    browser,
  }) => {
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/settings/branding'));

    // A colour nothing else in the fixture uses, so seeing it anywhere means
    // it came from this save.
    const brand = '#7b2d8e';
    await page.locator('input.font-mono').first().fill(brand);
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // A visitor with no session at all, which is who the front page is for.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    await visitor.goto(url(GRACE_HOST));

    expect(await token(visitor, '--primary')).toBe(brand);
    await visitorContext.close();

    // Put it back, so the fixture is what the seed says it is for every other
    // spec in the suite.
    await page.reload();
    await page.locator('input.font-mono').first().fill('#1f3a5f');
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
  });

  test('refuses anything that is not a colour', async ({ page }) => {
    // THE PROPERTY THIS PROTECTS. The theme is written by an institute admin
    // and rendered into a stylesheet on their own domain in front of their own
    // students, so a value that reached the page unparsed would be script
    // execution against them.
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/settings/branding'));

    await page
      .locator('input.font-mono')
      .first()
      .fill('#fff;}body{display:none}');
    await page.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.getByText(/not a colour/i)).toBeVisible();

    // And nothing reached the page: no stray declaration, no hidden body.
    await page.goto(url(GRACE_HOST));
    const css = await page.evaluate(() =>
      [...document.querySelectorAll('style')]
        .map((element) => element.textContent ?? '')
        .join(''),
    );

    expect(css).not.toContain('display:none');
    expect(css).not.toContain('<');
    await expect(page.locator('main')).toBeVisible();
  });

  test('is not something an instructor can change', async ({ page }) => {
    await signIn(page, PEOPLE.instructor);

    const response = await page.goto(url(GRACE_HOST, '/settings/branding'));
    expect(response?.status()).toBe(404);
  });
});
