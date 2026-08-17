import { expect, test } from '@playwright/test';
import { GRACE_HOST, PEOPLE, signIn, url } from '../helpers/browser';

/**
 * Manual enrollment (PRD requirement P0-11), from both ends.
 *
 * An admin granting access and the student then seeing it are two halves of
 * one claim, and asserting only the first is how you ship a screen that says
 * "Granted." over a row nobody can use.
 *
 * The subject is student2, who the fixture gives a course purchase and a
 * scholarship, and who no other spec writes to.
 */

const SUBJECT = PEOPLE.otherStudent;
/** Not covered by student2's seeded entitlements, so a grant is observable. */
const GRANTABLE = 'Old Testament Survey';

async function openSubject(page: import('@playwright/test').Page) {
  await page.goto(url(GRACE_HOST, '/settings/people'));
  await page.getByRole('link', { name: /Second Student/ }).click();
  await page.waitForURL('**/settings/people/**');
}

test.describe('enrolling somebody by hand', () => {
  test('reaches the student own profile, and can be taken away again', async ({
    page,
    browser,
  }) => {
    await signIn(page, PEOPLE.admin);
    await openSubject(page);

    await page.locator('select').selectOption({ label: GRANTABLE });
    await page
      .locator('input[placeholder*="Scholarship"]')
      .fill('Paid by cheque');
    await page.getByRole('button', { name: /^Enrol$/ }).click();
    await expect(page.getByText('Granted.')).toBeVisible();

    // A separate browser context, so this is the student's own session rather
    // than the admin's view of them.
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await signIn(studentPage, SUBJECT);
    await studentPage.goto(url(GRACE_HOST, '/account'));

    await expect(studentPage.locator('main')).toContainText(GRANTABLE);
    await expect(studentPage.locator('main')).toContainText(
      /enrolled by the office/i,
    );

    // And revoking it takes it away, which is the half everybody forgets.
    await page.reload();
    await page
      .locator('li', { hasText: GRANTABLE })
      .getByRole('button', { name: /remove/i })
      .click();
    await expect(page.getByText('Access removed.')).toBeVisible();

    await studentPage.reload();
    await expect(studentPage.locator('main')).not.toContainText(GRANTABLE);

    await studentContext.close();
  });

  test('says so rather than failing when they already have it', async ({
    page,
  }) => {
    // student2 holds the certificate program from the seed. Granting it again
    // hits the unique constraint, and an admin clicking twice deserves an
    // answer rather than a stack trace.
    await signIn(page, PEOPLE.admin);
    await openSubject(page);

    await page
      .locator('select')
      .selectOption({ label: 'Certificate in Ministry' });
    await page.getByRole('button', { name: /^Enrol$/ }).click();

    await expect(page.getByText(/already had that/i)).toBeVisible();
  });

  test('refuses an end date in the past', async ({ page }) => {
    await signIn(page, PEOPLE.admin);
    await openSubject(page);

    await page.locator('select').selectOption({ label: GRANTABLE });
    await page.locator('input[type=date]').fill('2020-01-01');
    await page.getByRole('button', { name: /^Enrol$/ }).click();

    await expect(page.getByText(/in the past/i)).toBeVisible();
  });

  test('is not available to an instructor', async ({ page }) => {
    // The roster is admin only. An instructor holds staff standing and no
    // business deciding who has paid for what.
    await signIn(page, PEOPLE.instructor);

    const response = await page.goto(url(GRACE_HOST, '/settings/people'));
    expect(response?.status()).toBe(404);
  });
});

test.describe('the roster', () => {
  test('lists this institute and nobody else', async ({ page }) => {
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/settings/people'));

    const body = await page.locator('main').innerText();

    // Grace's own people, including the person who studies at both.
    expect(body).toContain('instructor@gracebible.test');
    expect(body).toContain('shared.student@example.test');

    // Cornerstone's admin exists on the platform and must not appear here.
    expect(body).not.toContain('admin@cornerstone.test');
  });
});
