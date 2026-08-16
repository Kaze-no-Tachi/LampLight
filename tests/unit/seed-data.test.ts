import { describe, expect, it } from 'vitest';
import {
  CORNERSTONE,
  courseBySlug,
  firstGatedLesson,
  GRACE,
  seedUuid,
  SEED_TENANTS,
  SHARED_STUDENT,
  userByKey,
} from '@/db/seed-data';

/**
 * The isolation suite's assertions are only as good as the fixture underneath
 * them. These tests protect the properties the suite silently relies on: that
 * the two tenants really do look alike, that ids really are disjoint, and that
 * the enrollment shapes the later phases need are actually present.
 */

describe('seed fixture', () => {
  it('derives stable identifiers', () => {
    expect(seedUuid('tenant/grace')).toBe(seedUuid('tenant/grace'));
    expect(seedUuid('tenant/grace')).not.toBe(seedUuid('tenant/cornerstone'));
    expect(seedUuid('tenant/grace')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('gives both tenants identical slugs so a leak looks plausible', () => {
    expect(GRACE.courses.map((course) => course.slug)).toEqual(
      CORNERSTONE.courses.map((course) => course.slug),
    );
    expect(GRACE.programs.map((program) => program.slug)).toEqual(
      CORNERSTONE.programs.map((program) => program.slug),
    );
  });

  it('keeps every tenant scoped identifier disjoint between tenants', () => {
    const idsOf = (tenant: (typeof SEED_TENANTS)[number]) => [
      tenant.id,
      ...tenant.courses.map((course) => course.id),
      ...tenant.courses.map((course) => course.productId),
      ...tenant.programs.map((program) => program.id),
      ...tenant.enrollments.map((enrollment) => enrollment.id),
      ...tenant.courses.flatMap((course) =>
        course.modules.flatMap((courseModule) => [
          courseModule.id,
          ...courseModule.lessons.map((lesson) => lesson.id),
        ]),
      ),
    ];

    const grace = new Set(idsOf(GRACE));
    const overlap = idsOf(CORNERSTONE).filter((id) => grace.has(id));

    expect(overlap).toEqual([]);
  });

  it('shares exactly one user identity across both tenants', () => {
    expect(userByKey(GRACE, 'shared').id).toBe(SHARED_STUDENT.id);
    expect(userByKey(CORNERSTONE, 'shared').id).toBe(SHARED_STUDENT.id);

    const graceOnly = ['admin', 'instructor', 'student1', 'student2'];
    for (const key of graceOnly) {
      expect(userByKey(GRACE, key).id).not.toBe(userByKey(CORNERSTONE, key).id);
    }
  });

  it('includes every enrollment shape the later phases need', () => {
    for (const tenant of SEED_TENANTS) {
      const shapes = tenant.enrollments;

      expect(
        shapes.some((e) => e.sourceKind === 'program' && !e.manuallyGranted),
        `${tenant.slug} has no purchased program enrollment`,
      ).toBe(true);
      expect(
        shapes.some((e) => e.sourceKind === 'course' && !e.manuallyGranted),
        `${tenant.slug} has no purchased course enrollment`,
      ).toBe(true);
      expect(
        shapes.some((e) => e.manuallyGranted && e.expiresInDays !== null),
        `${tenant.slug} has no manually granted enrollment with an expiry`,
      ).toBe(true);
      expect(
        shapes.some((e) => (e.expiresInDays ?? 0) < 0),
        `${tenant.slug} has no expired enrollment`,
      ).toBe(true);
    }
  });

  it('gives every course a free preview lesson and a gated lesson', () => {
    for (const tenant of SEED_TENANTS) {
      for (const course of tenant.courses) {
        const all = course.modules.flatMap((courseModule) => courseModule.lessons);
        expect(all.filter((lesson) => lesson.isFreePreview)).toHaveLength(1);
        expect(firstGatedLesson(course)).toBeDefined();
      }
    }
  });

  it('leaves the instructor unassigned to some courses', () => {
    for (const tenant of SEED_TENANTS) {
      expect(tenant.instructorCourseSlugs.length).toBeGreaterThan(0);
      expect(tenant.instructorCourseSlugs.length).toBeLessThan(
        tenant.courses.length,
      );
    }
  });

  it('models a course that is only sellable inside a program', () => {
    const pastoral = courseBySlug(GRACE, 'pastoral-ministry');
    expect(pastoral.isStandalonePurchasable).toBe(false);
  });
});
