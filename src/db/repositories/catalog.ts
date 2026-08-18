import { and, asc, count, eq, inArray, isNull, sum } from 'drizzle-orm';
import {
  courseInstructors,
  courseResources,
  courseTagLinks,
  courseTags,
  courses,
  lessons,
  modules,
  products,
  programCourses,
  programs,
  users,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Example repository, catalog reads.
 *
 * The pattern every repository follows:
 *
 *   1. TenantScope is the first parameter, always.
 *   2. Every query filters on scope.tenantId explicitly, even though RLS would
 *      also filter it. That redundancy is the point: it is the application
 *      layer of the two-layer defence, and the isolation suite runs these
 *      functions with RLS bypassed specifically to prove this filter carries
 *      its own weight.
 *   3. A miss returns null or an empty array. Repositories never throw a
 *      "wrong tenant" error, because callers must not be able to tell a wrong
 *      tenant from a nonexistent row (PRD section 7).
 */

export type CatalogCourse = {
  id: string;
  title: string;
  slug: string;
  descriptionMd: string | null;
  isStandalonePurchasable: boolean;
  priceCents: number;
  currency: string;
};

export async function listPublishedCourses(
  scope: TenantScope,
): Promise<CatalogCourse[]> {
  return scope.tx
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      descriptionMd: courses.descriptionMd,
      isStandalonePurchasable: courses.isStandalonePurchasable,
      priceCents: products.priceCents,
      currency: products.currency,
    })
    .from(courses)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, courses.productId),
      ),
    )
    .where(
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(products.isPublished, true),
        isNull(courses.archivedAt),
      ),
    )
    .orderBy(asc(courses.title));
}

/**
 * One course by its address, for the public course page.
 *
 * THE LEAK THIS CLOSES. This used to filter on tenant and slug and nothing
 * else, while the list query beside it filtered on published. So an
 * unpublished course was not in the catalogue and was still reachable by
 * typing its address: title, description, and every public course document
 * rendered. Only the audio was protected, because that goes through the access
 * predicate rather than through here. The page's own comment claimed an
 * unpublished course was "not found", and it was not.
 *
 * The test that should have caught it checked the course was absent from the
 * catalogue list and never tried the URL.
 *
 * `includeUnpublished` exists for the editor, which has to show an author
 * their own draft, and every caller that passes it has already established the
 * viewer may author the course.
 */
export async function findCourseBySlug(
  scope: TenantScope,
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<CatalogCourse | null> {
  const rows = await scope.tx
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      descriptionMd: courses.descriptionMd,
      isStandalonePurchasable: courses.isStandalonePurchasable,
      priceCents: products.priceCents,
      currency: products.currency,
    })
    .from(courses)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, courses.productId),
      ),
    )
    .where(
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.slug, slug),
        // Archived is hidden from everybody, authors included: retiring a
        // course should take it off the author's list too, not just the
        // students'.
        isNull(courses.archivedAt),
        ...(options.includeUnpublished ? [] : [eq(products.isPublished, true)]),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export type CatalogProgram = {
  id: string;
  title: string;
  slug: string;
  descriptionMd: string | null;
  priceCents: number;
  /** How many courses the program contains, for the "4 courses" line. */
  courseCount: number;
};

export async function listPublishedPrograms(
  scope: TenantScope,
): Promise<CatalogProgram[]> {
  const rows = await scope.tx
    .select({
      id: programs.id,
      title: programs.title,
      slug: programs.slug,
      descriptionMd: programs.descriptionMd,
      priceCents: products.priceCents,
      courseCount: count(programCourses.courseId),
    })
    .from(programs)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, programs.productId),
      ),
    )
    // Left, not inner: a program that has been created but not yet filled
    // still belongs on the catalogue, reading as "0 courses" rather than
    // vanishing from it.
    .leftJoin(
      programCourses,
      and(
        eq(programCourses.tenantId, scope.tenantId),
        eq(programCourses.programId, programs.id),
      ),
    )
    .where(
      and(
        eq(programs.tenantId, scope.tenantId),
        eq(products.isPublished, true),
      ),
    )
    .groupBy(
      programs.id,
      programs.title,
      programs.slug,
      programs.descriptionMd,
      products.priceCents,
    )
    .orderBy(asc(programs.title));

  return rows.map((row) => ({ ...row, courseCount: Number(row.courseCount) }));
}

export type CourseResource = {
  id: string;
  kind: 'audio' | 'video' | 'pdf' | 'link';
  title: string;
  storageKey: string | null;
  url: string | null;
  filename: string | null;
  /** Null while an upload is reserved and unconfirmed. Links carry zero. */
  byteSize: number | null;
  isPublic: boolean;
};

/**
 * Documents attached to a course: the syllabus, a reading list, a handout.
 *
 * Returns every resource regardless of `is_public`, because the caller knows
 * whether the viewer is enrolled and this repository does not. Deciding that
 * here would put a second authority next to the access predicate.
 */
export async function listCourseResources(
  scope: TenantScope,
  courseId: string,
): Promise<CourseResource[]> {
  return scope.tx
    .select({
      id: courseResources.id,
      kind: courseResources.kind,
      title: courseResources.title,
      storageKey: courseResources.storageKey,
      url: courseResources.url,
      filename: courseResources.filename,
      byteSize: courseResources.byteSize,
      isPublic: courseResources.isPublic,
    })
    .from(courseResources)
    .where(
      and(
        eq(courseResources.tenantId, scope.tenantId),
        eq(courseResources.courseId, courseId),
      ),
    )
    .orderBy(asc(courseResources.sortOrder));
}

export type CourseTag = {
  id: string;
  slug: string;
  label: string;
};

/**
 * The institute's whole tag vocabulary, for the catalogue's filter chips and
 * the tag picker on the authoring screens.
 *
 * Ordered by label rather than by creation, because this is read as a list of
 * subjects rather than as a history of what an admin typed.
 */
export async function listCourseTags(scope: TenantScope): Promise<CourseTag[]> {
  return scope.tx
    .select({
      id: courseTags.id,
      slug: courseTags.slug,
      label: courseTags.label,
    })
    .from(courseTags)
    .where(eq(courseTags.tenantId, scope.tenantId))
    .orderBy(asc(courseTags.label));
}

/** A tag together with the course it is attached to. */
export type CourseTagLink = CourseTag & { courseId: string };

/**
 * Tags for a set of courses, in one query.
 *
 * Takes the ids the caller already has rather than re-deriving them, so the
 * catalogue costs two queries regardless of how many courses it lists. An
 * empty input short-circuits: `inArray` with an empty list is not a query
 * worth sending, and some drivers reject it outright.
 */
export async function listTagsForCourses(
  scope: TenantScope,
  courseIds: string[],
): Promise<CourseTagLink[]> {
  if (courseIds.length === 0) return [];

  return scope.tx
    .select({
      courseId: courseTagLinks.courseId,
      id: courseTags.id,
      slug: courseTags.slug,
      label: courseTags.label,
    })
    .from(courseTagLinks)
    .innerJoin(
      courseTags,
      and(
        eq(courseTags.tenantId, scope.tenantId),
        eq(courseTags.id, courseTagLinks.tagId),
      ),
    )
    .where(
      and(
        eq(courseTagLinks.tenantId, scope.tenantId),
        inArray(courseTagLinks.courseId, courseIds),
      ),
    )
    .orderBy(asc(courseTags.label));
}

export type CourseStats = {
  courseId: string;
  lessonCount: number;
  /** Null where no lesson on the course has a duration yet. */
  durationSeconds: number | null;
};

/**
 * Lesson counts and total running time per course, for the "12 lessons, 9
 * hours" line the catalogue and course pages both carry.
 *
 * Aggregated in the database rather than by loading lessons and counting in
 * the page, because the catalogue would otherwise pull every lesson of every
 * course to render one line of meta per row.
 *
 * Counts what a visitor can actually see: published, unarchived lessons, the
 * same filter listLessonsForCourse applies. A count that included drafts would
 * promise more on the catalogue than the course page then shows.
 *
 * A course whose lessons have no duration yet returns null rather than zero.
 * The two mean different things to a reader ("not recorded yet" against "no
 * time at all") and the page needs to be able to tell them apart.
 */
export async function listCourseStats(
  scope: TenantScope,
  courseIds: string[],
): Promise<CourseStats[]> {
  if (courseIds.length === 0) return [];

  const rows = await scope.tx
    .select({
      courseId: modules.courseId,
      lessonCount: count(lessons.id),
      durationSeconds: sum(lessons.durationSeconds),
    })
    .from(modules)
    .innerJoin(
      lessons,
      and(
        eq(lessons.tenantId, scope.tenantId),
        eq(lessons.moduleId, modules.id),
        isNull(lessons.archivedAt),
        eq(lessons.isPublished, true),
      ),
    )
    .where(
      and(
        eq(modules.tenantId, scope.tenantId),
        inArray(modules.courseId, courseIds),
      ),
    )
    .groupBy(modules.courseId);

  // `sum` comes back as a string from pg (numeric), and as null when every
  // lesson's duration is null.
  return rows.map((row) => ({
    courseId: row.courseId,
    lessonCount: Number(row.lessonCount),
    durationSeconds:
      row.durationSeconds === null ? null : Number(row.durationSeconds),
  }));
}

export type CourseInstructor = {
  userId: string;
  name: string | null;
  email: string;
};

/**
 * Who teaches a course, for the "Taught by" line on the course page.
 *
 * Reads through course_instructors, whose foreign key targets memberships
 * rather than users, so an instructor named here is structurally a member of
 * the same institute. The join to users is only to put a name to the id, and
 * users are global, which is why it carries no tenant filter of its own.
 */
export async function listCourseInstructors(
  scope: TenantScope,
  courseId: string,
): Promise<CourseInstructor[]> {
  return scope.tx
    .select({
      userId: courseInstructors.userId,
      name: users.name,
      email: users.email,
    })
    .from(courseInstructors)
    .innerJoin(users, eq(users.id, courseInstructors.userId))
    .where(
      and(
        eq(courseInstructors.tenantId, scope.tenantId),
        eq(courseInstructors.courseId, courseId),
      ),
    )
    .orderBy(asc(users.name));
}

export type ParentProgram = {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
};

/**
 * The programs a course belongs to.
 *
 * Plural because nothing stops an institute putting one course in both a
 * diploma and a certificate, and a page that assumed one would silently show
 * whichever the database happened to return first.
 *
 * Unpublished programs are excluded: a course sold on its own must not
 * advertise a diploma that is not on sale yet.
 */
export async function listProgramsForCourse(
  scope: TenantScope,
  courseId: string,
): Promise<ParentProgram[]> {
  return scope.tx
    .select({
      id: programs.id,
      title: programs.title,
      slug: programs.slug,
      priceCents: products.priceCents,
    })
    .from(programCourses)
    .innerJoin(
      programs,
      and(
        eq(programs.tenantId, scope.tenantId),
        eq(programs.id, programCourses.programId),
      ),
    )
    .innerJoin(
      products,
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, programs.productId),
      ),
    )
    .where(
      and(
        eq(programCourses.tenantId, scope.tenantId),
        eq(programCourses.courseId, courseId),
        eq(products.isPublished, true),
      ),
    )
    .orderBy(asc(programs.title));
}
