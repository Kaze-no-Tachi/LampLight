import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { courses, lessonResources, lessons, modules } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Example repository, lesson reads.
 *
 * `findLessonWithCourse` is the read the access predicate opens with
 * (PRD section 7). Lessons hang off modules, so the course id it needs comes
 * from a join, and both joins re-assert the tenant so a composite key cannot
 * be walked sideways into another tenant.
 */

export type LessonWithCourse = {
  id: string;
  title: string;
  slug: string;
  /** The instructor's notes for this lesson, markdown. */
  contentMd: string | null;
  isFreePreview: boolean;
  /** Draft until somebody says otherwise. See the note on the options below. */
  isPublished: boolean;
  durationSeconds: number | null;
  moduleId: string;
  courseId: string;
  /** Carried along because the player shows which course it is playing from. */
  courseTitle: string;
  courseSlug: string;
  sortOrder: number;
};

/**
 * Archived is always excluded here, with no option to include it: an archived
 * lesson is hidden from its own author too, not only from students, the same
 * rule an archived course gets (see findCourseBySlug beside
 * listPublishedCourses in ./catalog.ts).
 *
 * Draft is deliberately NOT filtered here. `findLessonWithCourse` is the read
 * decideLessonAccess opens with, and the predicate needs to see a draft lesson
 * to refuse it correctly for an ordinary student while still granting it to
 * admin and an assigned instructor: filtering it out here would deny every
 * branch, staff included, before the predicate ever got to decide. Listing
 * (below) is a different question and filters draft by default.
 */
export async function findLessonWithCourse(
  scope: TenantScope,
  lessonId: string,
): Promise<LessonWithCourse | null> {
  const rows = await scope.tx
    .select({
      id: lessons.id,
      title: lessons.title,
      slug: lessons.slug,
      contentMd: lessons.contentMd,
      isFreePreview: lessons.isFreePreview,
      isPublished: lessons.isPublished,
      durationSeconds: lessons.durationSeconds,
      moduleId: lessons.moduleId,
      courseId: modules.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      sortOrder: lessons.sortOrder,
    })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.tenantId, scope.tenantId),
        eq(modules.id, lessons.moduleId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.id, modules.courseId),
      ),
    )
    .where(
      and(
        eq(lessons.tenantId, scope.tenantId),
        eq(lessons.id, lessonId),
        isNull(lessons.archivedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * `includeUnpublished` is for the editor, which has to show an author their
 * own draft in the list they manage; every caller that passes it has already
 * established the viewer may author the course. Archived stays excluded
 * either way, matching findLessonWithCourse.
 */
export type LessonVisibility = { includeUnpublished?: boolean };

export async function listLessonsForCourse(
  scope: TenantScope,
  courseId: string,
  options: LessonVisibility = {},
): Promise<LessonWithCourse[]> {
  return scope.tx
    .select({
      id: lessons.id,
      title: lessons.title,
      slug: lessons.slug,
      contentMd: lessons.contentMd,
      isFreePreview: lessons.isFreePreview,
      isPublished: lessons.isPublished,
      durationSeconds: lessons.durationSeconds,
      moduleId: lessons.moduleId,
      courseId: modules.courseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      sortOrder: lessons.sortOrder,
    })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.tenantId, scope.tenantId),
        eq(modules.id, lessons.moduleId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.id, modules.courseId),
      ),
    )
    .where(
      and(
        eq(lessons.tenantId, scope.tenantId),
        eq(modules.courseId, courseId),
        isNull(lessons.archivedAt),
        ...(options.includeUnpublished ? [] : [eq(lessons.isPublished, true)]),
      ),
    )
    .orderBy(asc(modules.sortOrder), asc(lessons.sortOrder));
}

export type LessonResource = {
  id: string;
  kind: 'audio' | 'video' | 'pdf' | 'link';
  storageKey: string | null;
  filename: string | null;
  isDownloadable: boolean;
};

/**
 * Returns the storage keys for a lesson. Callers must have already cleared the
 * access predicate: this function answers "what objects belong to this
 * lesson", not "may this person have them".
 */
/**
 * The recordings a student may be offered.
 *
 * Only rows whose object is confirmed to exist, which is what a non-null
 * byte_size means: the row is written before the upload so that a file which
 * arrives always has something pointing at it, and the size is filled in
 * afterwards from a HEAD against the bucket. Serving the reserved rows too
 * would mean offering a lesson that plays silence, which is how this looked
 * before uploads were finished.
 */
export async function listLessonResources(
  scope: TenantScope,
  lessonId: string,
): Promise<LessonResource[]> {
  return scope.tx
    .select({
      id: lessonResources.id,
      kind: lessonResources.kind,
      storageKey: lessonResources.storageKey,
      filename: lessonResources.filename,
      isDownloadable: lessonResources.isDownloadable,
    })
    .from(lessonResources)
    .where(
      and(
        eq(lessonResources.tenantId, scope.tenantId),
        eq(lessonResources.lessonId, lessonId),
        isNotNull(lessonResources.byteSize),
      ),
    )
    .orderBy(asc(lessonResources.sortOrder));
}

export type AuthoringResource = LessonResource & {
  lessonId: string;
  /** Null while an upload is reserved but unconfirmed. */
  byteSize: number | null;
};

/**
 * Every recording attached to these lessons, including unfinished uploads.
 *
 * For the teaching screen, which is the one place that should see a reserved
 * row: an instructor whose upload failed needs to know it is there and be able
 * to try again or remove it.
 */
export async function listResourcesForLessons(
  scope: TenantScope,
  lessonIds: string[],
): Promise<AuthoringResource[]> {
  if (lessonIds.length === 0) return [];

  return scope.tx
    .select({
      id: lessonResources.id,
      lessonId: lessonResources.lessonId,
      kind: lessonResources.kind,
      storageKey: lessonResources.storageKey,
      filename: lessonResources.filename,
      isDownloadable: lessonResources.isDownloadable,
      byteSize: lessonResources.byteSize,
    })
    .from(lessonResources)
    .where(
      and(
        eq(lessonResources.tenantId, scope.tenantId),
        inArray(lessonResources.lessonId, lessonIds),
      ),
    )
    .orderBy(asc(lessonResources.sortOrder));
}
