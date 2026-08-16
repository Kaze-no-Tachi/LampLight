import { and, asc, eq, exists, gt, isNull, or, sql } from 'drizzle-orm';
import {
  courseInstructors,
  courses,
  enrollments,
  memberships,
  programCourses,
  programs,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Example repository, entitlement reads.
 *
 * These are the three reads the access predicate depends on (PRD section 7).
 * The predicate itself lands in the entitlements phase. What matters here is
 * that the queries it will call are already tenant-scoped, so the predicate
 * never has to think about tenancy.
 */

export type MembershipRecord = {
  userId: string;
  role: 'student' | 'instructor' | 'admin';
};

export async function findMembership(
  scope: TenantScope,
  userId: string,
): Promise<MembershipRecord | null> {
  const rows = await scope.tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, scope.tenantId),
        eq(memberships.userId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function isInstructorOf(
  scope: TenantScope,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const rows = await scope.tx
    .select({ ok: sql<number>`1` })
    .from(courseInstructors)
    .where(
      and(
        eq(courseInstructors.tenantId, scope.tenantId),
        eq(courseInstructors.userId, userId),
        eq(courseInstructors.courseId, courseId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Resolves both entitlement shapes in one query: a direct course enrollment,
 * or an enrollment in any program that contains the course. Expiry is applied
 * as `expires_at is null or expires_at > now()`, so a lapsed enrollment reads
 * exactly like no enrollment at all.
 */
export async function hasActiveEntitlement(
  scope: TenantScope,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const notExpired = or(
    isNull(enrollments.expiresAt),
    gt(enrollments.expiresAt, sql`now()`),
  );

  const coversCourseDirectly = and(
    eq(enrollments.sourceKind, 'course'),
    eq(enrollments.sourceId, courseId),
  );

  const coversCourseViaProgram = and(
    eq(enrollments.sourceKind, 'program'),
    exists(
      scope.tx
        .select({ ok: sql<number>`1` })
        .from(programCourses)
        .where(
          and(
            eq(programCourses.tenantId, scope.tenantId),
            eq(programCourses.programId, enrollments.sourceId),
            eq(programCourses.courseId, courseId),
          ),
        ),
    ),
  );

  const rows = await scope.tx
    .select({ ok: sql<number>`1` })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.userId, userId),
        notExpired,
        or(coversCourseDirectly, coversCourseViaProgram),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export type EnrollmentRecord = {
  id: string;
  sourceKind: 'program' | 'course';
  sourceId: string;
  expiresAt: Date | null;
  grantedBy: string | null;
};

export async function listEnrollments(
  scope: TenantScope,
  userId: string,
): Promise<EnrollmentRecord[]> {
  return scope.tx
    .select({
      id: enrollments.id,
      sourceKind: enrollments.sourceKind,
      sourceId: enrollments.sourceId,
      expiresAt: enrollments.expiresAt,
      grantedBy: enrollments.grantedBy,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.userId, userId),
      ),
    );
}

export type MembershipDetail = MembershipRecord & {
  /** Answers to this institute's own intake questions, unparsed. */
  profileJson: unknown;
  joinedAt: Date;
};

/**
 * The membership behind a profile page.
 *
 * Separate from findMembership, which every guarded request calls and which
 * therefore reads as little as it can. This one is for the single page that
 * shows a person their own record.
 */
export async function findMembershipDetail(
  scope: TenantScope,
  userId: string,
): Promise<MembershipDetail | null> {
  const rows = await scope.tx
    .select({
      userId: memberships.userId,
      role: memberships.role,
      profileJson: memberships.profileJson,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, scope.tenantId),
        eq(memberships.userId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export type EnrolledCourse = {
  courseId: string;
  title: string;
  slug: string;
  /** How this person came to have it: bought the course, or a whole program. */
  via: 'course' | 'program';
  /** The course title, or the program's, so the page can say where it came from. */
  sourceTitle: string;
  expiresAt: Date | null;
  /** True when an admin granted it rather than it arriving through an order. */
  granted: boolean;
};

/**
 * Every course this person is entitled to, and how each one arrived.
 *
 * Two queries rather than one union, because the join differs: a course
 * enrollment names the course, and a program enrollment reaches it through
 * program_courses. Expressing both in one statement makes a query nobody
 * wants to read to check the tenant filter, and the tenant filter is the
 * thing most worth being able to check at a glance.
 *
 * Expired rows are returned rather than hidden. This is the page where
 * somebody works out why a course they remember buying no longer opens, so
 * "your access ran out in March" is the answer they need. The access
 * predicate, which decides what actually plays, filters on expiry itself.
 *
 * ON THE TENANT FILTERS HERE, AND WHAT THE ISOLATION SUITE ACTUALLY PROVES
 *
 * There are two per query and either one alone is sufficient, which was found
 * by mutating them: removing the filter on `enrollments` leaves the join on
 * `courses` to drop the other institute's rows, and removing the one on
 * `courses` leaves the filter on `enrollments` to never select them. So a
 * mutation of either passes the isolation suite, and only removing both fails
 * it, which was checked.
 *
 * They stay, both of them. Redundant filters are the cheap half of the
 * two-layer model and the redundancy is what survives somebody later editing
 * one of these queries. But the suite is not evidence that each filter carries
 * its own weight here, and a comment claiming otherwise would be worse than no
 * comment.
 */
export async function listEnrolledCourses(
  scope: TenantScope,
  userId: string,
): Promise<EnrolledCourse[]> {
  const direct = await scope.tx
    .select({
      courseId: courses.id,
      title: courses.title,
      slug: courses.slug,
      sourceTitle: courses.title,
      expiresAt: enrollments.expiresAt,
      grantedBy: enrollments.grantedBy,
    })
    .from(enrollments)
    .innerJoin(
      courses,
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.id, enrollments.sourceId),
      ),
    )
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.userId, userId),
        eq(enrollments.sourceKind, 'course'),
      ),
    )
    .orderBy(asc(courses.title));

  const viaProgram = await scope.tx
    .select({
      courseId: courses.id,
      title: courses.title,
      slug: courses.slug,
      sourceTitle: programs.title,
      expiresAt: enrollments.expiresAt,
      grantedBy: enrollments.grantedBy,
    })
    .from(enrollments)
    .innerJoin(
      programs,
      and(
        eq(programs.tenantId, scope.tenantId),
        eq(programs.id, enrollments.sourceId),
      ),
    )
    .innerJoin(
      programCourses,
      and(
        eq(programCourses.tenantId, scope.tenantId),
        eq(programCourses.programId, programs.id),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.id, programCourses.courseId),
      ),
    )
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.userId, userId),
        eq(enrollments.sourceKind, 'program'),
      ),
    )
    .orderBy(asc(courses.title));

  const rows = [
    ...direct.map((row) => ({ ...row, via: 'course' as const })),
    ...viaProgram.map((row) => ({ ...row, via: 'program' as const })),
  ];

  // A course can be reached twice, by buying it and then buying the program
  // that contains it. It is one course on the page, listed under whichever
  // entitlement is still good, since that is the one that decides whether it
  // opens.
  const best = new Map<string, EnrolledCourse>();
  for (const row of rows) {
    const entry: EnrolledCourse = {
      courseId: row.courseId,
      title: row.title,
      slug: row.slug,
      via: row.via,
      sourceTitle: row.sourceTitle,
      expiresAt: row.expiresAt,
      granted: row.grantedBy !== null,
    };
    const existing = best.get(row.courseId);
    if (!existing || outranks(entry, existing)) best.set(row.courseId, entry);
  }

  return [...best.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Never expires beats a later expiry beats an earlier one. */
function outranks(
  candidate: EnrolledCourse,
  incumbent: EnrolledCourse,
): boolean {
  if (incumbent.expiresAt === null) return false;
  if (candidate.expiresAt === null) return true;
  return candidate.expiresAt > incumbent.expiresAt;
}
