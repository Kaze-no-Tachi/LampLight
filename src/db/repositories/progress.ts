import { and, eq, inArray } from 'drizzle-orm';
import { progress } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Where somebody got to in a lesson.
 *
 * The primary key is (tenant_id, user_id, lesson_id), so a person listening to
 * the same lesson at two institutes has two positions, which is correct: the
 * lessons are different rows even when the recording is the same file.
 */

export type LessonProgress = {
  lessonId: string;
  positionSeconds: number;
  completedAt: Date | null;
};

export async function findProgress(
  scope: TenantScope,
  userId: string,
  lessonId: string,
): Promise<LessonProgress | null> {
  const rows = await scope.tx
    .select({
      lessonId: progress.lessonId,
      positionSeconds: progress.positionSeconds,
      completedAt: progress.completedAt,
    })
    .from(progress)
    .where(
      and(
        eq(progress.tenantId, scope.tenantId),
        eq(progress.userId, userId),
        eq(progress.lessonId, lessonId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Positions for a set of lessons at once, for a course listing. */
export async function listProgressForLessons(
  scope: TenantScope,
  userId: string,
  lessonIds: string[],
): Promise<LessonProgress[]> {
  if (lessonIds.length === 0) return [];

  return scope.tx
    .select({
      lessonId: progress.lessonId,
      positionSeconds: progress.positionSeconds,
      completedAt: progress.completedAt,
    })
    .from(progress)
    .where(
      and(
        eq(progress.tenantId, scope.tenantId),
        eq(progress.userId, userId),
        inArray(progress.lessonId, lessonIds),
      ),
    );
}
