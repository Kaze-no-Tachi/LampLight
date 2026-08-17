import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { GRACE_HOST, PEOPLE, signIn, url } from '../helpers/browser';

/**
 * What an instructor changes, and what a student then sees.
 *
 * The pairing is the point. Every test here writes as one person and reads as
 * another, because "the editor saved it" and "the student got it" are
 * different claims, and the gap between them is where this feature broke twice
 * already: the replace button that appended, and the uploaded document with no
 * way to open it.
 *
 * Uploads need a bucket. CI runs one (see .github/workflows/ci.yml), so these
 * exercise the real signed PUT, the real confirm-against-the-bucket step, and
 * a real signed read, rather than being skipped where it matters.
 */

/** The seeded course these tests edit. It has the modules and lessons they need. */
const COURSE_WITH_LESSONS = 'Old Testament Survey';

/** A short real WAV, built here so the suite carries no binary fixtures. */
function wav(seconds = 3, hz = 440): Buffer {
  const rate = 8_000;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);

  for (let index = 0; index < samples; index += 1) {
    const t = index / rate;
    data.writeInt16LE(
      Math.round(Math.sin(2 * Math.PI * hz * t) * 0.1 * 32_767),
      index * 2,
    );
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

/** A tiny but structurally real PDF, for the same reason. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n',
);

/**
 * Opens the first course this instructor may edit, and reports which one.
 *
 * Returning the slug matters: an earlier version assumed the first course was
 * always Old Testament Survey, wrote to whatever the list happened to show
 * first, and then looked for the result on a different course's page. The
 * teaching list is ordered by title now, but a test should read where it
 * actually is rather than assume.
 */
async function openCourseEditor(page: Page): Promise<string> {
  await page.goto(url(GRACE_HOST, '/teach'));

  // A named course, not the first one on the page. These tests need a course
  // that has lessons in it, and "first" is whatever sorts earliest by title,
  // which changed the moment another spec started creating courses of its own.
  // Reading where it actually is beats assuming, and naming it beats both.
  await page
    .locator('section', { hasText: COURSE_WITH_LESSONS })
    .first()
    .getByRole('link', { name: /^Manage lessons$/ })
    .click();
  await page.waitForURL('**/courses/**/edit');

  const href = await page
    .getByRole('link', { name: /see what students see/i })
    .getAttribute('href');
  return href ?? '/catalogue';
}

test.describe('an instructor changing a course', () => {
  test('writes a description a student can read', async ({ page, context }) => {
    await signIn(page, PEOPLE.instructor);
    const coursePath = await openCourseEditor(page);

    const marker = `Covering the historical books ${Date.now()}`;
    await page
      .locator('#course-description')
      .fill(`## About\n\n${marker}\n\n- One\n- Two`);
    await page.getByRole('button', { name: /save course/i }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // A different person entirely, not a reload of the editor.
    const studentPage = await context.newPage();
    await studentPage.goto(url(GRACE_HOST, coursePath));
    await expect(studentPage.locator('main')).toContainText(marker);
    // The markdown subset renders as elements rather than as literal hashes.
    await expect(studentPage.locator('main h3').first()).toBeVisible();
  });

  test('refuses a link that is not a web address', async ({ page }) => {
    // Checked when it is stored rather than when it is rendered, because a
    // javascript: URL sitting in the database is a trap for whoever writes the
    // next page that displays it.
    await signIn(page, PEOPLE.instructor);
    await openCourseEditor(page);

    await page.locator('input[placeholder="Reading list"]').fill('Bad');
    await page
      .locator('input[placeholder="https://example.edu/reading-list.pdf"]')
      .fill('javascript:alert(1)');
    await page.getByRole('button', { name: /add link/i }).click();

    await expect(page.locator('p.text-destructive')).toContainText(
      /must start with https/i,
    );
  });

  test('uploads a syllabus a student can actually open', async ({
    page,
    context,
  }) => {
    // THE BUG THIS PREVENTS: uploaded documents used to render as inert text,
    // because the page only made a link when the row carried a URL, and an
    // uploaded one carries an object key instead.
    await signIn(page, PEOPLE.instructor);
    const coursePath = await openCourseEditor(page);

    const name = `Syllabus ${Date.now()}`;
    await page.locator('input[placeholder="Reading list"]').fill(name);
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'syllabus.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    });

    // The confirm step asks the bucket, so the row only appears once the
    // object is really there.
    await expect(page.getByText(name)).toBeVisible({ timeout: 20_000 });

    const studentPage = await context.newPage();
    await studentPage.goto(url(GRACE_HOST, coursePath));
    const link = studentPage.getByRole('link', { name });
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href, 'an uploaded document should get a signed URL').toContain('?');

    const fetched = await studentPage.evaluate(async (target) => {
      const signed = await fetch(target as string);
      const bare = await fetch((target as string).split('?')[0] ?? '');
      return { signed: signed.status, bare: bare.status };
    }, href);

    expect(fetched.signed).toBe(200);
    // The signature carries the authority, so without it the bucket refuses.
    // This is the whole reason media is not simply public.
    expect(fetched.bare).toBe(403);
  });

  test('replacing a recording replaces it', async ({ page }) => {
    // The button said "Replace audio" and appended, so the instructor was told
    // it was replaced and the student kept hearing the previous lecture. Found
    // by uploading a file and then listening as a student.
    await signIn(page, PEOPLE.instructor);
    await openCourseEditor(page);

    await page
      .getByRole('link', { name: /Lesson 4/ })
      .first()
      .click();
    await page.waitForURL('**/teach/lessons/**');

    const recordings = page
      .locator('section', { hasText: 'Recording' })
      .first();
    await recordings.locator('input[type=file]').setInputFiles({
      name: 'replacement.wav',
      mimeType: 'audio/wav',
      buffer: wav(),
    });

    await expect(recordings.getByText('replacement.wav')).toBeVisible({
      timeout: 20_000,
    });

    await page.reload();
    const rows = page
      .locator('section', { hasText: 'Recording' })
      .first()
      .locator('li li');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('replacement.wav');
  });

  test('refuses a file that is not audio', async ({ page }) => {
    await signIn(page, PEOPLE.instructor);
    await openCourseEditor(page);
    await page
      .getByRole('link', { name: /Lesson 3/ })
      .first()
      .click();
    await page.waitForURL('**/teach/lessons/**');

    const recordings = page
      .locator('section', { hasText: 'Recording' })
      .first();
    await recordings.locator('input[type=file]').setInputFiles({
      name: 'notes.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<h1>not audio</h1>'),
    });

    // By text rather than by class: the lesson editor renders errors in a span
    // and the Remove buttons carry the same destructive class, so a class
    // selector would match a button and pass for the wrong reason.
    await expect(page.getByText(/not a kind of audio/i)).toBeVisible();
  });
});

test.describe('who may teach', () => {
  test('a student cannot reach the teaching pages at all', async ({ page }) => {
    await signIn(page, PEOPLE.student);

    const response = await page.goto(url(GRACE_HOST, '/teach'));
    // The same 404 an unknown path gets. Being signed in is not the same as
    // having something to teach.
    expect(response?.status()).toBe(404);
  });

  test('an instructor sees only the courses they are assigned to', async ({
    page,
    request,
  }) => {
    await signIn(page, PEOPLE.instructor);

    // Pastoral Ministry exists at this institute and this instructor is not
    // assigned to it, which is the case a role check alone would let through.
    await page.goto(url(GRACE_HOST, '/teach'));
    const titles = await page.locator('h2').allTextContents();
    expect(titles.join(' ')).not.toContain('Pastoral Ministry');

    // Church History, not Pastoral Ministry: this instructor is not assigned
    // to either, but Pastoral Ministry is also seeded unpublished, which would
    // confound "not assigned" with "not published". Church History is
    // published, so a 200 here proves assignment does not gate public
    // visibility, the thing this test is actually about.
    const catalogue = await request.get('/catalogue/church-history', {
      headers: { host: GRACE_HOST },
    });
    expect(catalogue.status(), 'the course itself is public').toBe(200);
  });
});

test.describe('the teaching summary', () => {
  test('shows what is coming, with nothing that leads to a 404', async ({
    page,
  }) => {
    // Round 2, chunk 4: /teach stopped being the workspace and became a
    // summary, with Grading, Assessments and Roster shown honestly as not
    // built rather than left off or wired to a page that does not exist.
    await signIn(page, PEOPLE.instructor);
    await page.goto(url(GRACE_HOST, '/teach'));

    const card = page
      .locator('section', { hasText: COURSE_WITH_LESSONS })
      .first();

    for (const label of ['Grading', 'Assessments', 'Roster']) {
      const panel = card.locator('div', { hasText: label }).last();
      await expect(panel).toContainText(/coming soon/i);
      await expect(panel.getByRole('link')).toHaveCount(0);
    }

    // The one link this card offers actually goes somewhere, not to a 404.
    await card.getByRole('link', { name: /^Manage lessons$/ }).click();
    await page.waitForURL('**/courses/**/edit');
    await expect(
      page.getByRole('heading', { name: COURSE_WITH_LESSONS }),
    ).toBeVisible();
  });
});
