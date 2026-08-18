import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import {
  listCourseTags,
  listPublishedCourses,
  listTagsForCourses,
} from '@/db/repositories/catalog';
import { courseTags, courses, products } from '@/db/schema';
import { courseBySlug, CORNERSTONE, GRACE } from '@/db/seed-data';
import { withScope } from '../helpers/scope';
import {
  createCourse,
  setCoursePricing,
  setCoursePublished,
  setCourseTags,
} from '@/lib/catalog/authoring';

/**
 * The tag write path and the pricing write path, which the two authoring
 * screens (mockups 7 and 9) are the only callers of.
 *
 * Tags are worth this much coverage because almost nothing about them is
 * visible from the call site. Setting tags creates vocabulary rows, folds
 * labels that differ only in case onto one row, and deletes whatever is left
 * with no course on it. Each of those is a decision that would be silently
 * wrong: a duplicate reads as a second chip in the catalogue filter row, and a
 * missed prune reads as a chip that filters the catalogue down to nothing.
 *
 * Disposable courses throughout, cleaned up by id, matching the rest of this
 * suite. Tag labels are stamped per run so a leftover row from a crashed run
 * cannot make the next one pass.
 *
 * The cross-tenant cases run app-layer-only, through the RLS-bypassing
 * connection (see tests/helpers/scope.ts). Under RLS these writes cannot reach
 * another institute's rows whatever the code says, so a version of this file
 * that only used getTenantDb would pass with the tenant filter deleted from
 * setCourseTags. Checked by deleting it: both-layers stayed green,
 * app-layer-only went red.
 */

const created = new Set<string>();
const stamp = Date.now();

async function makeCourse(name: string): Promise<string> {
  const outcome = await getTenantDb(GRACE.id).run((scope) =>
    createCourse(scope, { title: name, slug: `${name}-${stamp}` }),
  );
  if (outcome.status !== 'ok') throw new Error(outcome.message);
  created.add(outcome.id);
  return outcome.id;
}

async function tagsOn(tenantId: string, courseId: string): Promise<string[]> {
  const rows = await getTenantDb(tenantId).run((scope) =>
    listTagsForCourses(scope, [courseId]),
  );
  return rows.map((row) => row.label).sort();
}

async function vocabulary(tenantId: string): Promise<string[]> {
  const rows = await getTenantDb(tenantId).run((scope) =>
    listCourseTags(scope),
  );
  return rows.map((row) => row.slug);
}

async function cleanup(): Promise<void> {
  if (created.size === 0) return;
  const ids = [...created];

  const rows = await getAdminDb()
    .select({ productId: courses.productId })
    .from(courses)
    .where(inArray(courses.id, ids));

  // The links go with the course, by the cascade on
  // course_tag_links_tenant_id_course_id_fk.
  await getAdminDb().delete(courses).where(inArray(courses.id, ids));

  const productIds = rows.map((row) => row.productId);
  if (productIds.length > 0) {
    await getAdminDb().delete(products).where(inArray(products.id, productIds));
  }

  // Vocabulary this file invented, which no cascade reaches: the tags belong
  // to the tenant, not to the course that first used them.
  await getAdminDb()
    .delete(courseTags)
    .where(
      and(
        eq(courseTags.tenantId, GRACE.id),
        inArray(courseTags.slug, [
          `probe-alpha-${stamp}`,
          `probe-beta-${stamp}`,
          `probe-shared-${stamp}`,
        ]),
      ),
    );

  created.clear();
}

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await closeDb();
});

describe('setting a course tags', () => {
  it('creates the vocabulary entry and links it', async () => {
    const courseId = await makeCourse('tags-create');

    await getTenantDb(GRACE.id).run((scope) =>
      setCourseTags(scope, courseId, [`Probe Alpha ${stamp}`]),
    );

    expect(await tagsOn(GRACE.id, courseId)).toEqual([`Probe Alpha ${stamp}`]);
    expect(await vocabulary(GRACE.id)).toContain(`probe-alpha-${stamp}`);
  });

  it('folds labels that differ only in case onto one tag', async () => {
    const courseId = await makeCourse('tags-case');

    await getTenantDb(GRACE.id).run((scope) =>
      setCourseTags(scope, courseId, [
        `Probe Alpha ${stamp}`,
        `probe alpha ${stamp}`,
        `PROBE ALPHA ${stamp}`,
      ]),
    );

    // One chip, not three that look alike in the catalogue's filter row.
    expect(await tagsOn(GRACE.id, courseId)).toHaveLength(1);
  });

  it('removes the tag from the vocabulary when its last course drops it', async () => {
    const courseId = await makeCourse('tags-prune');

    await getTenantDb(GRACE.id).run((scope) =>
      setCourseTags(scope, courseId, [
        `Probe Alpha ${stamp}`,
        `Probe Beta ${stamp}`,
      ]),
    );
    expect(await vocabulary(GRACE.id)).toContain(`probe-beta-${stamp}`);

    await getTenantDb(GRACE.id).run((scope) =>
      setCourseTags(scope, courseId, [`Probe Alpha ${stamp}`]),
    );

    // THE ONE THAT MATTERS. The catalogue builds its filter chips from the
    // whole vocabulary, so a tag left behind here is a chip that shows every
    // visitor an empty shelf.
    expect(await tagsOn(GRACE.id, courseId)).toEqual([`Probe Alpha ${stamp}`]);
    expect(await vocabulary(GRACE.id)).not.toContain(`probe-beta-${stamp}`);
  });

  it('keeps a tag another course still carries', async () => {
    const mine = await makeCourse('tags-keep-mine');
    const theirs = await makeCourse('tags-keep-theirs');

    for (const courseId of [mine, theirs]) {
      await getTenantDb(GRACE.id).run((scope) =>
        setCourseTags(scope, courseId, [`Probe Shared ${stamp}`]),
      );
    }

    await getTenantDb(GRACE.id).run((scope) => setCourseTags(scope, mine, []));

    expect(await tagsOn(GRACE.id, mine)).toEqual([]);
    expect(await tagsOn(GRACE.id, theirs)).toEqual([`Probe Shared ${stamp}`]);
    expect(await vocabulary(GRACE.id)).toContain(`probe-shared-${stamp}`);
  });

  it('never prunes another institute unused vocabulary', async () => {
    // THE PRUNE'S OWN TENANT FILTER, which nothing else here can catch.
    //
    // Cornerstone's seeded tags all have courses on them, so a prune that had
    // lost its tenant filter would still leave them alone and every other case
    // in this file would stay green. This plants an unused tag at Cornerstone,
    // which is exactly the row such a prune would reach for, and then runs a
    // save at Grace. Verified by deleting the filter: this is the only test
    // that goes red.
    const orphanSlug = `probe-orphan-${stamp}`;
    await getAdminDb()
      .insert(courseTags)
      .values({
        tenantId: CORNERSTONE.id,
        slug: orphanSlug,
        label: `Probe Orphan ${stamp}`,
      });

    try {
      const courseId = await makeCourse('tags-orphan-guard');
      await withScope('app-layer-only', GRACE.id, (scope) =>
        setCourseTags(scope, courseId, [`Probe Alpha ${stamp}`]),
      );

      expect(await vocabulary(CORNERSTONE.id)).toContain(orphanSlug);
    } finally {
      await getAdminDb()
        .delete(courseTags)
        .where(
          and(
            eq(courseTags.tenantId, CORNERSTONE.id),
            eq(courseTags.slug, orphanSlug),
          ),
        );
    }
  });

  it('leaves another institute holding the same slug alone', async () => {
    // Both fixtures seed the same tag slugs, which is what makes this worth
    // asserting: a prune that lost its tenant filter would strip the other
    // institute's vocabulary while looking entirely correct from Grace.
    const before = await vocabulary(CORNERSTONE.id);
    expect(before).toContain('survey');

    const courseId = await makeCourse('tags-foreign');
    await withScope('app-layer-only', GRACE.id, (scope) =>
      setCourseTags(scope, courseId, ['Survey']),
    );
    await withScope('app-layer-only', GRACE.id, (scope) =>
      setCourseTags(scope, courseId, []),
    );

    expect(await vocabulary(CORNERSTONE.id)).toEqual(before);
    const survey = courseBySlug(CORNERSTONE, 'old-testament-survey').id;
    expect(await tagsOn(CORNERSTONE.id, survey)).toContain('Survey');
  });

  it('answers not_found for a course belonging to another institute', async () => {
    const foreign = courseBySlug(CORNERSTONE, 'church-history').id;
    const outcome = await withScope('app-layer-only', GRACE.id, (scope) =>
      setCourseTags(scope, foreign, [`Probe Alpha ${stamp}`]),
    );

    expect(outcome.status).toBe('not_found');
    expect(await tagsOn(CORNERSTONE.id, foreign)).not.toContain(
      `Probe Alpha ${stamp}`,
    );
    expect(await vocabulary(GRACE.id)).not.toContain(`probe-alpha-${stamp}`);
  });
});

describe('setting how a course is sold', () => {
  it('puts the price on the product and the flag on the course', async () => {
    const courseId = await makeCourse('pricing-standalone');

    await getTenantDb(GRACE.id).run((scope) =>
      setCoursePricing(scope, courseId, {
        priceCents: 4900,
        isStandalonePurchasable: true,
      }),
    );
    await getTenantDb(GRACE.id).run((scope) =>
      setCoursePublished(scope, courseId, true),
    );

    const listed = await getTenantDb(GRACE.id).run((scope) =>
      listPublishedCourses(scope),
    );
    const row = listed.find((course) => course.id === courseId);

    expect(row?.priceCents).toBe(4900);
    expect(row?.isStandalonePurchasable).toBe(true);
  });

  it('leaves a program-only course with no price of its own', async () => {
    const courseId = await makeCourse('pricing-program');

    await getTenantDb(GRACE.id).run((scope) =>
      setCoursePricing(scope, courseId, {
        priceCents: 4900,
        isStandalonePurchasable: true,
      }),
    );
    await getTenantDb(GRACE.id).run((scope) =>
      setCoursePricing(scope, courseId, {
        priceCents: 0,
        isStandalonePurchasable: false,
      }),
    );
    await getTenantDb(GRACE.id).run((scope) =>
      setCoursePublished(scope, courseId, true),
    );

    const listed = await getTenantDb(GRACE.id).run((scope) =>
      listPublishedCourses(scope),
    );
    const row = listed.find((course) => course.id === courseId);

    // The old price does not linger under the new answer: a course that is
    // not sold separately must not still read as costing something.
    expect(row?.priceCents).toBe(0);
    expect(row?.isStandalonePurchasable).toBe(false);
  });

  it('answers not_found for a course belonging to another institute', async () => {
    const foreign = courseBySlug(CORNERSTONE, 'church-history').id;
    const before = await getTenantDb(CORNERSTONE.id).run((scope) =>
      listPublishedCourses(scope),
    );

    const outcome = await withScope('app-layer-only', GRACE.id, (scope) =>
      setCoursePricing(scope, foreign, {
        priceCents: 100,
        isStandalonePurchasable: true,
      }),
    );

    expect(outcome.status).toBe('not_found');

    // Repricing another institute's catalogue is the failure worth naming,
    // and the price is the half of it that has no other guard.
    const after = await getTenantDb(CORNERSTONE.id).run((scope) =>
      listPublishedCourses(scope),
    );
    expect(after.find((course) => course.id === foreign)?.priceCents).toBe(
      before.find((course) => course.id === foreign)?.priceCents,
    );
  });
});
