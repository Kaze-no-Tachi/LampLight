import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import {
  findCourseBySlug,
  listPublishedCourses,
} from '@/db/repositories/catalog';
import { courses, products } from '@/db/schema';
import { courseBySlug, GRACE } from '@/db/seed-data';

/**
 * What an unpublished or archived course is visible to.
 *
 * THE BUG THIS EXISTS FOR. findCourseBySlug filtered on tenant and slug and
 * nothing else, while listPublishedCourses beside it filtered on published. So
 * an unpublished course was absent from the catalogue and reachable by typing
 * its address, serving its title, its description, and its public documents.
 * Only the audio was protected, because that goes through a different check.
 *
 * The browser test that should have caught it asserted the course was missing
 * from the catalogue list and never tried the URL. Which is why this one asks
 * the query directly: a list and a lookup are two code paths, and covering one
 * says nothing about the other.
 */

const SUBJECT = courseBySlug(GRACE, 'church-history');

async function setPublished(isPublished: boolean): Promise<void> {
  const [course] = await getAdminDb()
    .select({ productId: courses.productId })
    .from(courses)
    .where(eq(courses.id, SUBJECT.id))
    .limit(1);

  if (!course) throw new Error('the fixture course is missing');

  await getAdminDb()
    .update(products)
    .set({ isPublished })
    .where(
      and(eq(products.tenantId, GRACE.id), eq(products.id, course.productId)),
    );
}

async function setArchived(archivedAt: Date | null): Promise<void> {
  await getAdminDb()
    .update(courses)
    .set({ archivedAt })
    .where(and(eq(courses.tenantId, GRACE.id), eq(courses.id, SUBJECT.id)));
}

afterAll(async () => {
  // Back to what the seed says, for every other suite.
  await setPublished(true);
  await setArchived(null);
  await closeDb();
});

describe('an unpublished course', () => {
  it('is absent from the catalogue and unreachable by address', async () => {
    await setPublished(false);

    const view = await getTenantDb(GRACE.id).run(async (scope) => ({
      listed: await listPublishedCourses(scope),
      bySlug: await findCourseBySlug(scope, SUBJECT.slug),
      forAnAuthor: await findCourseBySlug(scope, SUBJECT.slug, {
        includeUnpublished: true,
      }),
    }));

    expect(view.listed.map((course) => course.slug)).not.toContain(
      SUBJECT.slug,
    );
    expect(
      view.bySlug,
      'a draft must not be readable by guessing its address',
    ).toBeNull();

    // And the author can still open their own draft, or the editor would be
    // unable to show anybody the thing they are writing.
    expect(view.forAnAuthor?.slug).toBe(SUBJECT.slug);
  });
});

describe('an archived course', () => {
  it('is hidden from authors too, not only from students', async () => {
    await setPublished(true);
    await setArchived(new Date());

    const view = await getTenantDb(GRACE.id).run(async (scope) => ({
      listed: await listPublishedCourses(scope),
      bySlug: await findCourseBySlug(scope, SUBJECT.slug),
      forAnAuthor: await findCourseBySlug(scope, SUBJECT.slug, {
        includeUnpublished: true,
      }),
    }));

    expect(view.listed.map((course) => course.slug)).not.toContain(
      SUBJECT.slug,
    );
    expect(view.bySlug).toBeNull();
    // Retiring a course takes it off the author's list as well. Otherwise
    // "archived" means "hidden from students", which is what unpublishing
    // already does, and the two would be indistinguishable.
    expect(view.forAnAuthor).toBeNull();
  });
});
