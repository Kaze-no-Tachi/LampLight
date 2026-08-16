import {
  findCourseBySlug,
  listCourseResources,
  listPublishedCourses,
  listPublishedPrograms,
} from '@/db/repositories/catalog';
import {
  findMembership,
  findMembershipDetail,
  hasActiveEntitlement,
  isInstructorOf,
  listEnrolledCourses,
  listEnrollments,
} from '@/db/repositories/entitlements';
import { findBranding, findSignupQuestions } from '@/db/repositories/settings';
import {
  findDomain,
  findPrimaryDomain,
  listDomains,
} from '@/db/repositories/domains';
import {
  findLessonWithCourse,
  listLessonResources,
  listLessonsForCourse,
} from '@/db/repositories/lessons';
import type { TenantScope } from '@/db/scope';
import {
  courseBySlug,
  firstGatedLesson,
  programBySlug,
  userByKey,
  type SeedTenant,
} from '@/db/seed-data';

/**
 * The registry of every read path in the codebase.
 *
 * Each entry runs a repository function under `scope` while referring to
 * identifiers owned by `subject`, and returns the identifiers of rows in the
 * result that genuinely belong to `subject`.
 *
 * That return contract is what makes one registry serve both directions:
 *
 *   scope.tenantId === subject.id  ->  the result must be non-empty, which
 *                                      proves the assertion is exercising a
 *                                      real query rather than passing because
 *                                      the fixture is empty.
 *   scope.tenantId !== subject.id  ->  the result must be empty. Anything
 *                                      returned is, by construction, another
 *                                      tenant's data.
 *
 * The two tenants share every slug, so a lookup by slug under the wrong tenant
 * still finds a row: the caller's own. Filtering the result down to rows owned
 * by `subject` is what tells "correctly returned my own lookalike row" apart
 * from "leaked the other tenant's row".
 *
 * ADDING A READ PATH IN A LATER PHASE MEANS ADDING IT HERE, IN THE SAME
 * COMMIT. tests/isolation/read-path-coverage.test.ts checks this registry
 * against the exported functions of src/db/repositories and fails when one is
 * missing.
 */
export type ReadPath = {
  /** Must match "<module>.<exportedFunction>". */
  name: string;
  run(scope: TenantScope, subject: SeedTenant): Promise<string[]>;
};

/** Keeps only the ids that belong to `subject`, which is the leak signal. */
function ownedBySubject(ids: string[], subjectIds: Set<string>): string[] {
  return ids.filter((id) => subjectIds.has(id));
}

function domainIds(tenant: SeedTenant): Set<string> {
  return new Set(tenant.domains.map((domain) => domain.id));
}

function courseIds(tenant: SeedTenant): Set<string> {
  return new Set(tenant.courses.map((course) => course.id));
}

function lessonIds(tenant: SeedTenant): Set<string> {
  return new Set(
    tenant.courses.flatMap((course) =>
      course.modules.flatMap((courseModule) =>
        courseModule.lessons.map((lesson) => lesson.id),
      ),
    ),
  );
}

export const READ_PATHS: ReadPath[] = [
  {
    name: 'catalog.listCourseResources',
    async run(scope, subject) {
      // Named by course id, which is the shape a missing tenant filter leaks:
      // an institute asking about another's course and getting its syllabus.
      const course = courseBySlug(subject, 'old-testament-survey');
      const rows = await listCourseResources(scope, course.id);
      const subjectIds = new Set(
        subject.courses.map((item) => item.syllabusId),
      );
      return ownedBySubject(
        rows.map((row) => row.id),
        subjectIds,
      );
    },
  },
  {
    name: 'settings.findBranding',
    async run(scope, subject) {
      // Keyed by tenant id, so the row this returns under another institute's
      // scope is either its own brand (fine) or the subject's (a leak, and a
      // visible one: it would serve one institute's logo on another's domain).
      const row = await findBranding(scope);
      return ownedBySubject(row ? [row.tenantId] : [], new Set([subject.id]));
    },
  },
  {
    name: 'domains.listDomains',
    async run(scope, subject) {
      const rows = await listDomains(scope);
      return ownedBySubject(
        rows.map((row) => row.id),
        domainIds(subject),
      );
    },
  },
  {
    name: 'domains.findDomain',
    async run(scope, subject) {
      // Named by id, which is the case a missing tenant filter would leak: an
      // institute asking about a domain row that is not its own.
      const target = subject.domains[0];
      if (!target) return [];
      const row = await findDomain(scope, target.id);
      return ownedBySubject(row ? [row.id] : [], domainIds(subject));
    },
  },
  {
    name: 'domains.findPrimaryDomain',
    async run(scope, subject) {
      const row = await findPrimaryDomain(scope);
      return ownedBySubject(row ? [row.id] : [], domainIds(subject));
    },
  },
  {
    name: 'catalog.listPublishedCourses',
    async run(scope, subject) {
      const rows = await listPublishedCourses(scope);
      return ownedBySubject(
        rows.map((row) => row.id),
        courseIds(subject),
      );
    },
  },
  {
    name: 'catalog.findCourseBySlug',
    async run(scope, subject) {
      // Both tenants own a course with this slug, so the wrong-tenant call
      // returns a plausible row rather than nothing.
      const target = courseBySlug(subject, 'church-history');
      const row = await findCourseBySlug(scope, target.slug);
      return ownedBySubject(row ? [row.id] : [], courseIds(subject));
    },
  },
  {
    name: 'catalog.listPublishedPrograms',
    async run(scope, subject) {
      const rows = await listPublishedPrograms(scope);
      const subjectIds = new Set(subject.programs.map((program) => program.id));
      return ownedBySubject(
        rows.map((row) => row.id),
        subjectIds,
      );
    },
  },
  {
    name: 'lessons.findLessonWithCourse',
    async run(scope, subject) {
      const lesson = firstGatedLesson(
        courseBySlug(subject, 'systematic-theology-i'),
      );
      const row = await findLessonWithCourse(scope, lesson.id);
      return ownedBySubject(row ? [row.id] : [], lessonIds(subject));
    },
  },
  {
    name: 'lessons.listLessonsForCourse',
    async run(scope, subject) {
      const course = courseBySlug(subject, 'new-testament-survey');
      const rows = await listLessonsForCourse(scope, course.id);
      return ownedBySubject(
        rows.map((row) => row.id),
        lessonIds(subject),
      );
    },
  },
  {
    name: 'lessons.listLessonResources',
    async run(scope, subject) {
      const lesson = firstGatedLesson(
        courseBySlug(subject, 'old-testament-survey'),
      );
      const rows = await listLessonResources(scope, lesson.id);
      const resourceIds = new Set(
        subject.courses.flatMap((course) =>
          course.modules.flatMap((courseModule) =>
            courseModule.lessons.map((entry) => entry.resourceId),
          ),
        ),
      );
      return ownedBySubject(
        rows.map((row) => row.id),
        resourceIds,
      );
    },
  },
  {
    name: 'entitlements.findMembership',
    async run(scope, subject) {
      // The subject's admin is a member of the subject tenant only, so any
      // membership returned under another tenant's scope is a leak.
      const admin = userByKey(subject, 'admin');
      const row = await findMembership(scope, admin.id);
      return row ? [admin.id] : [];
    },
  },
  {
    name: 'entitlements.isInstructorOf',
    async run(scope, subject) {
      const instructor = userByKey(subject, 'instructor');
      const course = courseBySlug(subject, 'old-testament-survey');
      const assigned = await isInstructorOf(scope, instructor.id, course.id);
      return assigned ? [course.id] : [];
    },
  },
  {
    name: 'entitlements.hasActiveEntitlement',
    async run(scope, subject) {
      // The shared student holds this entitlement at both tenants, so a query
      // that lost its tenant filter finds the other tenant's enrollment row
      // and wrongly reports access. See the fixture note on shared-hermeneutics.
      const shared = userByKey(subject, 'shared');
      const course = courseBySlug(subject, 'hermeneutics');
      const entitled = await hasActiveEntitlement(scope, shared.id, course.id);
      return entitled ? [course.id] : [];
    },
  },
  {
    name: 'entitlements.listEnrollments',
    async run(scope, subject) {
      const shared = userByKey(subject, 'shared');
      const rows = await listEnrollments(scope, shared.id);
      const subjectEnrollmentIds = new Set(
        subject.enrollments.map((enrollment) => enrollment.id),
      );
      return ownedBySubject(
        rows.map((row) => row.id),
        subjectEnrollmentIds,
      );
    },
  },
  {
    name: 'entitlements.listEnrolledCourses',
    async run(scope, subject) {
      // The shared student is a member of both institutes with enrollments in
      // each, which is the case that matters: a missing tenant filter here
      // shows somebody the other institute's courses on their profile page,
      // and it would look plausible because both fixtures share every slug.
      const shared = userByKey(subject, 'shared');
      const rows = await listEnrolledCourses(scope, shared.id);
      return ownedBySubject(
        rows.map((row) => row.courseId),
        courseIds(subject),
      );
    },
  },
  {
    name: 'entitlements.findMembershipDetail',
    async run(scope, subject) {
      const admin = userByKey(subject, 'admin');
      const row = await findMembershipDetail(scope, admin.id);
      return row ? [admin.id] : [];
    },
  },
  {
    name: 'settings.findSignupQuestions',
    async run(scope, subject) {
      // Not identified by a row id, so the leak signal is the content: Grace
      // asks questions and Cornerstone asks none, and reading the wrong
      // institute's list is how one institute's intake form ends up on
      // another institute's signup page.
      const questions = await findSignupQuestions(scope);
      const asked = Array.isArray(questions) && questions.length > 0;
      const subjectAsks = subject.signupMode === 'open';
      return asked === subjectAsks ? [subject.id] : [];
    },
  },
];

/**
 * Read paths whose positive case is legitimately empty, so the "non-empty
 * under the owning tenant" assertion does not apply. Kept explicit rather than
 * skipped silently. Empty today, and an entry here should be argued for.
 */
export const READ_PATHS_WITHOUT_POSITIVE_CASE: string[] = [];

export { programBySlug };
