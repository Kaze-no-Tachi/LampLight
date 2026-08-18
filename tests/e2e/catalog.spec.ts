import {
  addLesson,
  createCourse,
  GRACE_HOST,
  openCourseSettings,
  PEOPLE,
  SEED_PASSWORD,
  signIn,
  url,
} from '../helpers/browser';
import { expect, test } from '../helpers/test';
import { courseBySlug, GRACE } from '@/db/seed-data';

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

async function openCatalog(page: import('@playwright/test').Page) {
  await page.goto(url(GRACE_HOST, '/teach'));
}

test.describe('an admin building a catalogue', () => {
  test('creates a course, publishes it, and a visitor can find it', async ({
    page,
    context,
  }) => {
    await signIn(page, PEOPLE.admin);

    // Created through the new-course screen (mockup 7), which replaced the
    // four-field form that used to sit inline on the teaching list.
    await createCourse(page, NAME, { slug: 'church-history-test' });

    // Publish state is a toggle on course settings now rather than a button on
    // the list, so the whole cycle happens on the screen that owns it.
    const publish = page.getByRole('switch');
    await expect(page.getByText('A draft, visible only here')).toBeVisible();

    // Unpublished means invisible, which is the half that is easy to get wrong.
    const visitor = await context.newPage();
    await visitor.goto(url(GRACE_HOST, '/catalogue'));
    await expect(visitor.locator('main')).not.toContainText(NAME);

    await publish.click();
    await expect(page.getByText('On your catalogue')).toBeVisible();

    await visitor.reload();
    await expect(visitor.locator('main')).toContainText(NAME);

    // The teaching list reports the same fact, which is the other half of what
    // moving the control could have broken.
    await openCatalog(page);
    await expect(
      page.locator('[data-testid="course-card"]', { hasText: NAME }).first(),
    ).toContainText('Published');

    // And withdrawing takes it back out, which is the half everybody forgets.
    await openCourseSettings(page, NAME);
    await page.getByRole('switch').click();
    await expect(page.getByText('A draft, visible only here')).toBeVisible();

    await visitor.reload();
    await expect(visitor.locator('main')).not.toContainText(NAME);
  });

  test('refuses a second course on the same web address', async ({ page }) => {
    // Two courses sharing a slug means one of them is unreachable, and the
    // database constraint would report it as an unhandled error rather than
    // as something the person can fix.
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/teach/courses/new'));

    await page
      .locator('input[placeholder="The Minor Prophets"]')
      .fill('Old Testament Survey');
    await page.getByRole('button', { name: /^Create course$/ }).click();

    // Reported beside the button, in words, rather than thrown: the address is
    // derived from the title, so this is the one error somebody hits without
    // having typed an address at all.
    await expect(page.getByText(/already uses the address/i)).toBeVisible();
  });

  test('assigning an instructor is what puts it on their teaching list', async ({
    page,
    browser,
  }) => {
    await signIn(page, PEOPLE.admin);

    const title = `Homiletics ${Date.now()}`;
    await createCourse(page, title);

    // Assignment moved off the teaching list onto course settings (mockup 9),
    // where there is room to say who teaches a course and what that means.
    await expect(page.getByText(/nobody yet/i)).toBeVisible();

    // The roster is an rsuite SelectPicker rather than a <select>, so it is
    // driven the way somebody uses it: open it, pick the person by name.
    await page.getByRole('combobox').click();
    await page
      .getByRole('option', { name: /instructor@/ })
      .first()
      .click();

    await expect(page.getByText(/instructor@gracebible.test/)).toBeVisible();

    // Their own session, not the admin's view of it.
    const theirs = await browser.newContext();
    const theirPage = await theirs.newPage();
    await signIn(theirPage, PEOPLE.instructor);
    await theirPage.goto(url(GRACE_HOST, '/teach'));
    await expect(theirPage.locator('main')).toContainText(title);

    await theirs.close();
  });

  test('is not usable by an instructor', async ({ page }) => {
    // Deciding what the institute teaches, and who teaches it, is not an
    // instructor's call even though editing the content is: the same /teach
    // page an instructor reaches shows none of the catalogue controls that
    // used to live on their own settings page.
    await signIn(page, PEOPLE.instructor);
    await page.goto(url(GRACE_HOST, '/teach'));

    await expect(page.getByRole('link', { name: /^New course$/ })).toHaveCount(
      0,
    );
    // No publish state at all on the list, which is where an instructor would
    // otherwise learn what is on the catalogue and be tempted to change it.
    await expect(page.getByText(/^Published$/)).toHaveCount(0);
  });
});

test.describe('every admin screen is reachable', () => {
  test('from the header, without knowing the URL', async ({ page }) => {
    // Domains and Signup were built and linked from nowhere. A screen you can
    // only reach by typing its path is a screen that does not exist for the
    // person who needs it.
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/account'));

    // The labels the reskin settled on. "Catalogue" used to name the
    // catalogue-administration screen, which chunk 5 folded into /teach, and
    // "Signup settings" shortened to "Signup". What the test is actually
    // about has not changed: an admin can reach every one of these without
    // knowing its path.
    for (const [label, path] of [
      ['Teach', '/teach'],
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

    for (const label of ['Teach', 'People', 'Domains', 'Signup'] as const) {
      await expect(
        page.getByRole('link', { name: label, exact: true }),
      ).toHaveCount(0);
    }

    // The public catalogue is still theirs to browse, which is the thing this
    // must not accidentally assert away.
    await expect(
      page.getByRole('link', { name: 'Courses', exact: true }),
    ).toBeVisible();
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
    await visitor.goto(url(GRACE_HOST, '/catalogue'));
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
    //
    // Polled, because the click starts a request and returns. Reading the
    // session once, immediately, races it and fails about one run in three.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const response = await fetch('/api/auth/get-session', {
              cache: 'no-store',
            });
            const body = (await response.json()) as { user?: unknown } | null;
            return Boolean(body?.user);
          }),
        { message: 'the session should be gone', timeout: 10_000 },
      )
      .toBe(false);

    // And a gated page is gated again.
    const response = await page.goto(url(GRACE_HOST, '/account'));
    expect(response?.status()).toBe(404);
  });
});

test.describe('adding lessons', () => {
  test('never mentions sections, and the lesson reaches a student', async ({
    page,
    context,
  }) => {
    // THE FLOW THIS REPLACES. Adding lesson two meant: leave the course, add a
    // "section" from the teaching list, come back, find the section, add the
    // lesson to it. Three screens and a concept an institute writing its first
    // course has no use for. A course comes with a section nobody sees.
    //
    // Adding a lesson is now a page rather than a modal (mockup 8), and that
    // page is where a second section can be named. The assertion below is the
    // one that keeps the round 2 decision honest: on a course with a single
    // section, neither screen says the word.
    await signIn(page, PEOPLE.admin);

    const course = `Pastoral Care ${Date.now()}`;
    const courseId = await createCourse(page, course);

    // Not on the course's own screen.
    await expect(page.locator('main')).not.toContainText('section', {
      ignoreCase: true,
    });

    // And not on the screen that adds a lesson to it either, beyond the one
    // disclosure link that exists to make a second section possible at all.
    await page.goto(url(GRACE_HOST, `/teach/courses/${courseId}/lessons/new`));
    await expect(page.getByText(/which section/i)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /put it in a new section/i }),
    ).toHaveCount(1);

    const lesson = `Visiting the sick ${Date.now()}`;
    await addLesson(page, courseId, lesson, { openToEveryone: true });

    await expect(page.locator('main')).toContainText(lesson);

    // A new lesson is a draft (round 2, chunk 3), free preview or not: being
    // open to everyone is a different question from being finished. Publish
    // the lesson itself before the course, or a student would find nothing
    // there regardless of what the course-level toggle says.
    const lessonRow = page.locator('li', { hasText: lesson });
    await expect(lessonRow).toContainText('Draft');
    await expect(lessonRow).toContainText('Open to all');
    await lessonRow.getByRole('button', { name: /^Publish$/ }).click();
    await expect(lessonRow).not.toContainText('Draft');

    // Publish the course and check a visitor gets the free preview lesson,
    // which is the whole chain: created, listed, visible.
    await page.getByRole('switch').click();
    await expect(page.getByText('On your catalogue')).toBeVisible();

    const visitor = await context.newPage();
    await visitor.goto(url(GRACE_HOST, '/catalogue'));
    await visitor.getByRole('link', { name: course }).first().click();
    await expect(visitor.locator('main')).toContainText(lesson);
  });
});

test.describe('your own account', () => {
  test('lets you change your password, and the new one works', async ({
    page,
    browser,
  }) => {
    // The page listed courses and nothing else. Changing a password you still
    // know meant using the forgotten-password flow and claiming otherwise.
    // student2 is the subject: no other test signs in as them.
    await signIn(page, PEOPLE.otherStudent);
    await page.goto(url(GRACE_HOST, '/account'));

    const next = 'a-brand-new-password-99';
    await page.locator('input[name="currentPassword"]').fill(SEED_PASSWORD);
    await page.locator('input[name="newPassword"]').fill(next);
    await page.getByRole('button', { name: /^Change password$/ }).click();
    await expect(page.getByText(/Password changed/i)).toBeVisible();

    // Proof, in a fresh context: the new password signs in.
    const after = await browser.newContext();
    const fresh = await after.newPage();
    await fresh.goto(url(GRACE_HOST, '/sign-in'));
    await fresh.locator('input[name=email]').fill(PEOPLE.otherStudent);
    await fresh.locator('input[name=password]').fill(next);
    await fresh.getByRole('button', { name: /sign in/i }).click();
    await fresh.waitForURL('**/account', { timeout: 15_000 });

    // Put it back, so the fixture is what the seed says for every other spec.
    await fresh.locator('input[name="currentPassword"]').fill(next);
    await fresh.locator('input[name="newPassword"]').fill(SEED_PASSWORD);
    await fresh.getByRole('button', { name: /^Change password$/ }).click();
    await expect(fresh.getByText(/Password changed/i)).toBeVisible();

    await after.close();
  });

  test('refuses when the current password is wrong', async ({ page }) => {
    await signIn(page, PEOPLE.student);
    await page.goto(url(GRACE_HOST, '/account'));

    await page.locator('input[name="currentPassword"]').fill('not-my-password');
    await page.locator('input[name="newPassword"]').fill('some-new-password-1');
    await page.getByRole('button', { name: /^Change password$/ }).click();

    await expect(page.getByText(/Check your current password/i)).toBeVisible();
  });
});

test.describe('the student shelf and self-enrolment', () => {
  // student1 holds old-testament-survey, new-testament-survey and
  // systematic-theology-i through the diploma program (seed), and neither
  // church-history nor hermeneutics. Two different unheld courses, so the
  // enrolling test and the signed-out test cannot interfere with each other.
  const UNHELD_ENROLLABLE = 'church-history';
  const UNHELD_FOR_VISITOR = 'hermeneutics';
  const HELD_VIA_PROGRAM = 'old-testament-survey';

  test('enrols from the catalogue, and the course appears on the shelf', async ({
    page,
  }) => {
    await signIn(page, PEOPLE.student);
    await page.goto(url(GRACE_HOST, `/catalogue/${UNHELD_ENROLLABLE}`));

    await expect(page.getByRole('button', { name: /^Enrol$/ })).toBeVisible();

    await page.getByRole('button', { name: /^Enrol$/ }).click();
    await expect(
      page.getByText(/you are enrolled in this course/i),
    ).toBeVisible();

    await page.goto(url(GRACE_HOST, '/courses'));
    const row = page
      .locator('[data-testid="shelf-course"]')
      .filter({ hasText: 'Church History' });
    await expect(row).toBeVisible();
    // No progress yet, so the shelf offers Start rather than Continue.
    await expect(row.getByRole('link', { name: /^Start$/ })).toBeVisible();

    // Cleanup, through the admin path this suite already trusts: an
    // unrevoked enrolment here would make a second run of this test find the
    // Enrol button already gone.
    await signIn(page, PEOPLE.admin);
    await page.goto(url(GRACE_HOST, '/settings/people'));
    // Selecting a row fills the panel beside it (mockup 10), which is also
    // where an entitlement is now taken away.
    await page.getByRole('link', { name: /First Student/ }).click();
    await page.waitForURL('**/settings/people?person=*');
    await page
      .locator('li', { hasText: 'Church History' })
      .getByRole('button', { name: /^Remove$/ })
      .click();
    await expect(page.locator('li', { hasText: 'Church History' })).toHaveCount(
      0,
    );
  });

  test('a course already held offers no enrol button', async ({ page }) => {
    await signIn(page, PEOPLE.student);
    await page.goto(url(GRACE_HOST, `/catalogue/${HELD_VIA_PROGRAM}`));

    await expect(
      page.getByText(/you are enrolled in this course/i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Enrol$/ })).toHaveCount(0);
  });

  test('prompts sign in when signed out, and returns to the same course', async ({
    page,
  }) => {
    await page.goto(url(GRACE_HOST, `/catalogue/${UNHELD_FOR_VISITOR}`));

    const link = page.getByRole('link', { name: /sign in to enrol/i });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe(
      `/sign-in?next=%2Fcatalogue%2F${UNHELD_FOR_VISITOR}`,
    );

    await link.click();
    await page.locator('input[name=email]').fill(PEOPLE.student);
    await page.locator('input[name=password]').fill(SEED_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL(`**/catalogue/${UNHELD_FOR_VISITOR}`, {
      timeout: 15_000,
    });
    // Landed back on the course, now as somebody who may enrol in it.
    await expect(page.getByRole('button', { name: /^Enrol$/ })).toBeVisible();
  });

  test('the shelf shows a held course and its program alongside it', async ({
    page,
  }) => {
    // The seed's progress row for student1 sits on old-testament-survey's
    // second lesson, deliberately not its first (see src/db/seed.ts), which
    // exists to prove a gated lesson's position survives, not to change what
    // the shelf offers. "Next" is still the first lesson in teaching order
    // that carries no completedAt, which is the untouched first lesson, so
    // this reads Start rather than Continue: the label ternary itself is one
    // line off a field the isolation harness already covers, and player.spec
    // already drives real playback and position sync.
    await signIn(page, PEOPLE.student);
    await page.goto(url(GRACE_HOST, '/courses'));

    // The course title also appears inside the program card below, in the
    // program's per-course breakdown. The shelf's own row is the one carrying
    // the test id, which is what tells the two apart now that neither is a
    // list item.
    const row = page
      .locator('[data-testid="shelf-course"]')
      .filter({ hasText: 'Old Testament Survey' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: /^Start$/ })).toBeVisible();

    // The diploma program this course belongs to gets its own summary too.
    // Every one of its three courses also names the program on its own shelf
    // row ("Via Diploma in Biblical Studies"), so the percent sign is what
    // singles out the program's own card: no per-course row shows one.
    const program = page
      .locator('li', { hasText: 'Diploma in Biblical Studies' })
      .filter({ hasText: '%' });
    await expect(program).toBeVisible();
    await expect(program).toContainText('0%');
  });
});

test.describe('the unified course editor', () => {
  test('adds lessons without leaving, reorders, publishes, and archives', async ({
    page,
  }) => {
    await signIn(page, PEOPLE.admin);

    const title = `Homiletics II ${Date.now()}`;
    const courseId = await createCourse(page, title);

    // Three lessons, never naming a "section" the way the old flow made you.
    for (const name of ['Lesson One', 'Lesson Two', 'Lesson Three']) {
      await addLesson(page, courseId, name);
      await expect(page.locator('main')).toContainText(name);
    }

    // Every fresh lesson starts a draft.
    await expect(page.locator('li', { hasText: 'Lesson One' })).toContainText(
      'Draft',
    );

    // Reorder: Lesson Two moves up, ahead of Lesson One.
    await page
      .locator('li', { hasText: 'Lesson Two' })
      .getByRole('button', { name: /move lesson two up/i })
      .click();
    await expect
      .poll(async () => {
        const rows = await page.locator('main li').allTextContents();
        const two = rows.findIndex((row) => row.includes('Lesson Two'));
        const one = rows.findIndex((row) => row.includes('Lesson One'));
        return two >= 0 && one >= 0 && two < one;
      })
      .toBe(true);

    // Publish, then withdraw, the same lesson.
    const firstRow = page.locator('li', { hasText: 'Lesson One' });
    await firstRow.getByRole('button', { name: /^Publish$/ }).click();
    await expect(firstRow).not.toContainText('Draft');
    await firstRow.getByRole('button', { name: /^Withdraw$/ }).click();
    await expect(firstRow).toContainText('Draft');

    // Archive a lesson: it leaves the list entirely, not just its state.
    await page
      .locator('li', { hasText: 'Lesson Three' })
      .getByRole('button', { name: /^Archive$/ })
      .click();
    const archiveLessonDialog = page.getByRole('dialog');
    await archiveLessonDialog
      .getByRole('button', { name: /^Archive$/ })
      .click();
    await expect(archiveLessonDialog).toBeHidden();
    await expect(page.locator('main')).not.toContainText('Lesson Three');

    // Archive the course itself. The one-way door, admin only.
    await page.getByRole('button', { name: /^Archive this course$/ }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Archive$/ })
      .click();
    await page.waitForURL('**/teach');

    // Gone from the admin catalogue, same as the public one.
    await openCatalog(page);
    await expect(page.locator('main')).not.toContainText(title);
  });

  test('refuses a student, whatever they are enrolled in', async ({ page }) => {
    // student1 holds this exact course through the diploma program, which is
    // the case a role check alone would let through: real entitlement, real
    // access to every lesson, and still no standing to edit it.
    await signIn(page, PEOPLE.student);
    const courseId = courseBySlug(GRACE, 'old-testament-survey').id;

    const response = await page.goto(
      url(GRACE_HOST, `/teach/courses/${courseId}`),
    );
    expect(response?.status()).toBe(404);
  });
});
