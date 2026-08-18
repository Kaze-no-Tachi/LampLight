import { GRACE_HOST, PEOPLE, signIn, url } from '../helpers/browser';
import { clientAddress, clientHeaders, expect, test } from '../helpers/test';

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

/**
 * Selects the subject on the people screen.
 *
 * Selection is a URL rather than component state (mockup 10), so the panel
 * that grants access arrives with the page rather than after a click that
 * nothing waits for.
 */
async function openSubject(page: import('@playwright/test').Page) {
  await page.goto(url(GRACE_HOST, '/settings/people'));
  await page.getByRole('link', { name: /Second Student/ }).click();
  await page.waitForURL('**/settings/people?person=*');
  await expect(page.getByText(/grant access by hand/i)).toBeVisible();
}

/** Picks a program or course in the panel's roster picker. */
async function chooseSource(
  page: import('@playwright/test').Page,
  label: string,
) {
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test.describe('enrolling somebody by hand', () => {
  test('reaches the student own profile, and can be taken away again', async ({
    page,
    browser,
  }) => {
    await signIn(page, PEOPLE.admin);
    await openSubject(page);

    await chooseSource(page, GRANTABLE);
    await page
      .locator('input[placeholder*="Paid by cheque"]')
      .fill('Paid by cheque');
    await page.getByRole('button', { name: /^Grant access$/ }).click();

    // The button itself reports it, which is what the design asks for: no
    // toast, and the words appear where the click landed.
    await expect(
      page.getByRole('button', { name: /^Access granted$/ }),
    ).toBeVisible();

    // A separate browser context, so this is the student's own session rather
    // than the admin's view of them. Its own client address too: a context
    // made here does not inherit the one the fixture gives the test, and two
    // sign-ins sharing a bucket is how this suite met the rate limiter.
    const studentContext = await browser.newContext({
      extraHTTPHeaders: clientHeaders(clientAddress('enrolment student')),
    });
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
      .getByRole('button', { name: /^Remove$/ })
      .click();
    // The row leaving is the report. Nothing else in the panel says so, on
    // purpose: the only place a message could go is the grant button.
    await expect(page.locator('li', { hasText: GRANTABLE })).toHaveCount(0);

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

    await chooseSource(page, 'Certificate in Ministry');
    await page.getByRole('button', { name: /^Grant access$/ }).click();

    await expect(page.getByText(/already had that/i)).toBeVisible();
  });

  test('refuses an end date in the past', async ({ page }) => {
    await signIn(page, PEOPLE.admin);
    await openSubject(page);

    await chooseSource(page, GRANTABLE);
    await page.locator('input[type=date]').fill('2020-01-01');
    await page.getByRole('button', { name: /^Grant access$/ }).click();

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

    // Staff read as Staff rather than Lapsed: they hold standing without an
    // entitlement, and the reskin had to decide what that column says about
    // somebody who was never enrolled in anything.
    await expect(
      page.getByRole('link', { name: /Lead Instructor/ }),
    ).toContainText('Staff');
  });
});
