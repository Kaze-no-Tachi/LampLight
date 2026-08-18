import { and, asc, eq, exists, gt, isNull, or, sql } from 'drizzle-orm';
import {
  courseInstructors,
  courses,
  enrollments,
  memberships,
  programCourses,
  programs,
  users,
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
  /** Platform-wide, from the users table. What other people here see. */
  name: string;
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
      // From the global users table, so the tenant filter stays on
      // memberships. That is the row that decides whether this person belongs
      // here; users is joined to read the name off an id we have already
      // established belongs to this institute.
      name: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
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

export type RosterEntry = {
  userId: string;
  email: string;
  name: string;
  role: 'student' | 'instructor' | 'admin';
  joinedAt: Date;
  /** How many entitlements this person holds here, expired ones included. */
  enrollmentCount: number;
};

/**
 * Everyone who belongs to this institute.
 *
 * Joins the global users table, which is the one place a tenant-scoped read
 * touches global data, and it is safe for a specific reason: the set of rows is
 * decided by memberships, which is tenant scoped, and the join only puts a name
 * and an address on ids this institute already holds. It is not a way to browse
 * the platform's users, because a user with no membership here never appears.
 */
export async function listRoster(scope: TenantScope): Promise<RosterEntry[]> {
  const rows = await scope.tx
    .select({
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
      enrollmentCount: sql<number>`(
        select count(*) from enrollments e
        where e.tenant_id = ${scope.tenantId}
          and e.user_id = ${memberships.userId}
      )`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, scope.tenantId))
    .orderBy(asc(users.email));

  return rows.map((row) => ({
    ...row,
    // count() comes back as a string from pg for bigint.
    enrollmentCount: Number(row.enrollmentCount),
  }));
}

export type GrantableSource = {
  kind: 'program' | 'course';
  id: string;
  title: string;
};

/**
 * Everything an admin can grant: this institute's programs and courses.
 *
 * Unpublished ones included, deliberately. An institute drafting a course still
 * needs to be able to put a staff member or a pilot student into it, and
 * publication is about whether strangers can buy it, not about who may be
 * enrolled.
 */
export async function listGrantableSources(
  scope: TenantScope,
): Promise<GrantableSource[]> {
  const programRows = await scope.tx
    .select({ id: programs.id, title: programs.title })
    .from(programs)
    .where(eq(programs.tenantId, scope.tenantId))
    .orderBy(asc(programs.title));

  const courseRows = await scope.tx
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(eq(courses.tenantId, scope.tenantId))
    .orderBy(asc(courses.title));

  return [
    ...programRows.map((row) => ({ kind: 'program' as const, ...row })),
    ...courseRows.map((row) => ({ kind: 'course' as const, ...row })),
  ];
}

export type EnrollmentDetail = EnrollmentRecord & {
  /** The program or course this entitlement covers, by name. */
  sourceTitle: string;
  grantedAt: Date;
};

/**
 * The entitlements one person holds here, named, for the admin screen.
 *
 * Different from listEnrolledCourses, which expands a program into the courses
 * it contains because that is what a student wants to see. An admin managing
 * access needs the rows as granted, since those are what can be revoked.
 */
export async function listEnrollmentDetails(
  scope: TenantScope,
  userId: string,
): Promise<EnrollmentDetail[]> {
  const rows = await scope.tx
    .select({
      id: enrollments.id,
      sourceKind: enrollments.sourceKind,
      sourceId: enrollments.sourceId,
      expiresAt: enrollments.expiresAt,
      grantedBy: enrollments.grantedBy,
      grantedAt: enrollments.grantedAt,
      programTitle: programs.title,
      courseTitle: courses.title,
    })
    .from(enrollments)
    // Left joins, one per source kind, because source_id is a polymorphic
    // reference: exactly one of these matches for any given row.
    .leftJoin(
      programs,
      and(
        eq(programs.tenantId, scope.tenantId),
        eq(programs.id, enrollments.sourceId),
      ),
    )
    .leftJoin(
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
      ),
    )
    .orderBy(asc(enrollments.grantedAt));

  return rows.map((row) => ({
    id: row.id,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    expiresAt: row.expiresAt,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt,
    sourceTitle: row.programTitle ?? row.courseTitle ?? 'Removed',
  }));
}

export type RosterAccess = {
  userId: string;
  sourceKind: 'program' | 'course';
  sourceTitle: string;
  expiresAt: Date | null;
};

/**
 * Every entitlement at this institute, by the person holding it.
 *
 * The people screen needs two columns per member that a count cannot answer:
 * what they can reach, by name, and whether any of it is still live. Asking
 * listEnrollmentDetails once per member would be a query per row, so this
 * answers for the whole roster in one.
 *
 * Read on the server and rendered there. The rows never reach the browser,
 * which is what keeps a large institute's roster from becoming a large
 * institute's payload.
 *
 * Expired rows are included rather than filtered. "Their access ran out in
 * March" is the answer to the question that brings an admin to this screen,
 * and the caller decides how to say it.
 */
export async function listRosterAccess(
  scope: TenantScope,
): Promise<RosterAccess[]> {
  const rows = await scope.tx
    .select({
      userId: enrollments.userId,
      sourceKind: enrollments.sourceKind,
      expiresAt: enrollments.expiresAt,
      programTitle: programs.title,
      courseTitle: courses.title,
    })
    .from(enrollments)
    // Left joins, one per source kind, because source_id is a polymorphic
    // reference: exactly one of these matches for any given row. Both are
    // tenant filtered as well, so a title can only ever come from here.
    .leftJoin(
      programs,
      and(
        eq(programs.tenantId, scope.tenantId),
        eq(programs.id, enrollments.sourceId),
      ),
    )
    .leftJoin(
      courses,
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.id, enrollments.sourceId),
      ),
    )
    .where(eq(enrollments.tenantId, scope.tenantId))
    .orderBy(asc(enrollments.grantedAt));

  return rows.map((row) => ({
    userId: row.userId,
    sourceKind: row.sourceKind,
    expiresAt: row.expiresAt,
    sourceTitle: row.programTitle ?? row.courseTitle ?? 'Removed',
  }));
}
