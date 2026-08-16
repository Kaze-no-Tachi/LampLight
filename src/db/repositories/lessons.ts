import { and, asc, eq } from 'drizzle-orm';
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
  isFreePreview: boolean;
  durationSeconds: number | null;
  moduleId: string;
  courseId: string;
};

export async function findLessonWithCourse(
  scope: TenantScope,
  lessonId: string,
): Promise<LessonWithCourse | null> {
  const rows = await scope.tx
    .select({
      id: lessons.id,
      title: lessons.title,
      slug: lessons.slug,
      isFreePreview: lessons.isFreePreview,
      durationSeconds: lessons.durationSeconds,
      moduleId: lessons.moduleId,
      courseId: modules.courseId,
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
    .where(and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, lessonId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function listLessonsForCourse(
  scope: TenantScope,
  courseId: string,
): Promise<LessonWithCourse[]> {
  return scope.tx
    .select({
      id: lessons.id,
      title: lessons.title,
      slug: lessons.slug,
      isFreePreview: lessons.isFreePreview,
      durationSeconds: lessons.durationSeconds,
      moduleId: lessons.moduleId,
      courseId: modules.courseId,
    })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.tenantId, scope.tenantId),
        eq(modules.id, lessons.moduleId),
      ),
    )
    .where(
      and(eq(lessons.tenantId, scope.tenantId), eq(modules.courseId, courseId)),
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
      ),
    )
    .orderBy(asc(lessonResources.sortOrder));
}
