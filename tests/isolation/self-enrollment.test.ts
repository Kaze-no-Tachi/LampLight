import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { getAdminDb } from '@/db/admin';
import { closeDb, getTenantDb } from '@/db/client';
import { auditLog, enrollments } from '@/db/schema';
import { CORNERSTONE, courseBySlug, GRACE, userByKey } from '@/db/seed-data';
import { can } from '@/lib/access/can';
import { enrollSelf } from '@/lib/entitlements/grants';

/**
 * Self-enrolment (round 2 of the course and lesson flow): a member putting
 * themselves on a published course, no admin and no payment involved.
 *
 * THE BUG THIS EXISTS FOR. `can`'s course:enroll checked for a direct course
 * enrolment row and nothing else, so a student entitled to a course only
 * through a program they hold read as not-yet-enrolled and was offered the
 * button again. Enrolling would have written a second, redundant direct
 * entitlement for a course they could already open. student1 holds the
 * diploma program, which covers old-testament-survey, and never holds it
 * directly, which is exactly the case a direct-only lookup gets wrong.
 *
 * hermeneutics is used for the "may enrol" cases: student1 holds it neither
 * directly nor through the diploma, and no other isolation file touches it.
 */

const student1 = userByKey(GRACE, 'student1');

const HELD_VIA_PROGRAM = courseBySlug(GRACE, 'old-testament-survey');
const UNHELD = courseBySlug(GRACE, 'hermeneutics');
const UNPUBLISHED = courseBySlug(GRACE, 'pastoral-ministry');

function actor(overrides: Partial<Parameters<typeof can>[1]> = {}) {
  return {
    tenantId: GRACE.id,
    userId: student1.id,
    role: 'student' as const,
    ...overrides,
  };
}

/** Enrolment ids this file created, and the only rows cleanup may touch. */
const created = new Set<string>();

async function cleanup(): Promise<void> {
  if (created.size === 0) return;
  await getAdminDb()
    .delete(enrollments)
    .where(inArray(enrollments.id, [...created]));
  created.clear();
}

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await closeDb();
});

describe('deciding whether somebody may enrol themselves', () => {
  it('allows a member on a published course they do not hold', async () => {
    const verdict = await getTenantDb(GRACE.id).run((scope) =>
      can(scope, actor(), 'course:enroll', {
        kind: 'course',
        id: UNHELD.id,
      }),
    );
    expect(verdict).toEqual({ allowed: true, reason: 'published-course' });
  });

  it('refuses a course that is not published', async () => {
    const verdict = await getTenantDb(GRACE.id).run((scope) =>
      can(scope, actor(), 'course:enroll', {
        kind: 'course',
        id: UNPUBLISHED.id,
      }),
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-published' });
  });

  it('reads as already enrolled when directly enrolled', async () => {
    const outcome = await enrollSelf({
      tenantId: GRACE.id,
      userId: student1.id,
      courseId: UNHELD.id,
    });
    if (outcome.status !== 'enrolled') throw new Error('enrol failed');
    created.add(outcome.enrollmentId);

    const verdict = await getTenantDb(GRACE.id).run((scope) =>
      can(scope, actor(), 'course:enroll', {
        kind: 'course',
        id: UNHELD.id,
      }),
    );
    expect(verdict).toEqual({ allowed: false, reason: 'already-enrolled' });
  });

  it('reads as already enrolled when entitled through a program, with no direct row', async () => {
    // THE ONE THAT MATTERS. No direct enrolment exists for this course: the
    // only row is the diploma program enrolment from the seed.
    const direct = await getAdminDb()
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.tenantId, GRACE.id),
          eq(enrollments.userId, student1.id),
          eq(enrollments.sourceKind, 'course'),
          eq(enrollments.sourceId, HELD_VIA_PROGRAM.id),
        ),
      );
    expect(direct).toHaveLength(0);

    const verdict = await getTenantDb(GRACE.id).run((scope) =>
      can(scope, actor(), 'course:enroll', {
        kind: 'course',
        id: HELD_VIA_PROGRAM.id,
      }),
    );
    expect(verdict).toEqual({ allowed: false, reason: 'already-enrolled' });
  });

  it('refuses somebody with no session', async () => {
    const verdict = await getTenantDb(GRACE.id).run((scope) =>
      can(scope, actor({ userId: null, role: null }), 'course:enroll', {
        kind: 'course',
        id: UNHELD.id,
      }),
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-signed-in' });
  });

  it('refuses a signed-in visitor with no membership here', async () => {
    const verdict = await getTenantDb(GRACE.id).run((scope) =>
      can(scope, actor({ role: null }), 'course:enroll', {
        kind: 'course',
        id: UNHELD.id,
      }),
    );
    expect(verdict).toEqual({ allowed: false, reason: 'not-a-member' });
  });
});

describe('enrolSelf', () => {
  it('writes a null grantedBy, which the rest of the product reads as purchased', async () => {
    const outcome = await enrollSelf({
      tenantId: GRACE.id,
      userId: student1.id,
      courseId: UNHELD.id,
    });
    if (outcome.status !== 'enrolled') throw new Error('enrol failed');
    created.add(outcome.enrollmentId);

    const [row] = await getAdminDb()
      .select({ grantedBy: enrollments.grantedBy })
      .from(enrollments)
      .where(eq(enrollments.id, outcome.enrollmentId));
    expect(row?.grantedBy).toBeNull();

    const [audit] = await getAdminDb()
      .select({ actor: auditLog.actorUserId, action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, GRACE.id),
          eq(auditLog.targetId, outcome.enrollmentId),
        ),
      );
    expect(audit?.action).toBe('enrollment.self_enrolled');
    expect(audit?.actor).toBe(student1.id);
  });

  it('says so rather than failing when already enrolled', async () => {
    const first = await enrollSelf({
      tenantId: GRACE.id,
      userId: student1.id,
      courseId: UNHELD.id,
    });
    if (first.status !== 'enrolled') throw new Error('enrol failed');
    created.add(first.enrollmentId);

    const second = await enrollSelf({
      tenantId: GRACE.id,
      userId: student1.id,
      courseId: UNHELD.id,
    });
    expect(second.status).toBe('already');
  });

  it('refuses a course id that belongs to another institute', async () => {
    // Ids are unguessable, and unguessable is not an access control. Both
    // institutes seed a course with this slug, so the wrong id is a real row.
    const outcome = await enrollSelf({
      tenantId: GRACE.id,
      userId: student1.id,
      courseId: courseBySlug(CORNERSTONE, 'hermeneutics').id,
    });
    expect(outcome.status).toBe('error');
  });
});
