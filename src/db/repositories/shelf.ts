import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  courses,
  enrollments,
  lessons,
  modules,
  programCourses,
  programs,
  progress,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';
import { listEnrolledCourses } from './entitlements';

/**
 * The student's own shelf: what they are on, and where they are in it.
 *
 * Separate from the catalogue reads, which answer "what does this institute
 * offer". These answer "what am I part way through", which needs progress
 * joined to entitlement and is nobody else's business.
 *
 * The counts deliberately consider only published, unarchived lessons. A
 * student's "3 of 8" should not move because an instructor started drafting a
 * ninth, and it should not stall at 7 of 8 because one was retired.
 */

export type ShelfLesson = {
  id: string;
  title: string;
  /** Seconds in, from the last sync. Zero for a lesson never opened. */
  positionSeconds: number;
};

export type ShelfCourse = {
  courseId: string;
  title: string;
  slug: string;
  via: 'course' | 'program';
  sourceTitle: string;
  expiresAt: Date | null;
  lessonCount: number;
  completedCount: number;
  /**
   * The lesson to open next: the first incomplete one in order. Null when the
   * course is finished, or has no published lessons yet.
   */
  next: ShelfLesson | null;
};

/** Published, unarchived lessons of these courses, in the order they are taught. */
async function lessonsOf(
  scope: TenantScope,
  courseIds: string[],
): Promise<{ id: string; title: string; courseId: string }[]> {
  if (courseIds.length === 0) return [];

  return scope.tx
    .select({
      id: lessons.id,
      title: lessons.title,
      courseId: modules.courseId,
    })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.tenantId, lessons.tenantId),
        eq(modules.id, lessons.moduleId),
      ),
    )
    .where(
      and(
        eq(lessons.tenantId, scope.tenantId),
        inArray(modules.courseId, courseIds),
        eq(lessons.isPublished, true),
        isNull(lessons.archivedAt),
      ),
    )
    .orderBy(asc(modules.sortOrder), asc(lessons.sortOrder));
}

export async function listShelfCourses(
  scope: TenantScope,
  userId: string,
): Promise<ShelfCourse[]> {
  // Entitlement first, and through the existing helper rather than a second
  // copy of its rules: it already resolves direct enrolments and program ones,
  // dedupes them, and knows which grant outranks which.
  const entitled = await listEnrolledCourses(scope, userId);

  const live = entitled.filter(
    (course) => !course.expiresAt || course.expiresAt > new Date(),
  );
  if (live.length === 0) return [];

  const courseIds = live.map((course) => course.courseId);
  const taught = await lessonsOf(scope, courseIds);

  const marks = taught.length
    ? await scope.tx
        .select({
          lessonId: progress.lessonId,
          completedAt: progress.completedAt,
          positionSeconds: progress.positionSeconds,
        })
        .from(progress)
        .where(
          and(
            eq(progress.tenantId, scope.tenantId),
            eq(progress.userId, userId),
            inArray(
              progress.lessonId,
              taught.map((lesson) => lesson.id),
            ),
          ),
        )
    : [];

  const byLesson = new Map(marks.map((mark) => [mark.lessonId, mark]));

  return live.map((course) => {
    const mine = taught.filter((lesson) => lesson.courseId === course.courseId);
    const completedCount = mine.filter(
      (lesson) => byLesson.get(lesson.id)?.completedAt,
    ).length;

    // First incomplete, in teaching order. "Continue" and "Start" are the same
    // question asked twice: this is the answer, and whether they have started
    // it is what picks the word.
    const next = mine.find((lesson) => !byLesson.get(lesson.id)?.completedAt);

    return {
      ...course,
      lessonCount: mine.length,
      completedCount,
      next: next
        ? {
            id: next.id,
            title: next.title,
            positionSeconds: byLesson.get(next.id)?.positionSeconds ?? 0,
          }
        : null,
    };
  });
}

export type ProgramProgressCourse = {
  courseId: string;
  title: string;
  slug: string;
  lessonCount: number;
  completedCount: number;
};

export type ProgramProgress = {
  programId: string;
  title: string;
  slug: string;
  courses: ProgramProgressCourse[];
  /** Whole lessons across the whole program, not an average of averages. */
  percent: number;
};

/**
 * Programs this person is enrolled in, and how far through each one they are.
 *
 * Percentage is computed over every lesson in the program rather than by
 * averaging the courses, because a program with a two lesson course and a
 * thirty lesson course is not half finished when the short one is done.
 */
export async function listProgramProgress(
  scope: TenantScope,
  userId: string,
): Promise<ProgramProgress[]> {
  const mine = await scope.tx
    .select({
      programId: programs.id,
      title: programs.title,
      slug: programs.slug,
      expiresAt: enrollments.expiresAt,
    })
    .from(enrollments)
    .innerJoin(
      programs,
      and(
        eq(programs.tenantId, enrollments.tenantId),
        eq(programs.id, enrollments.sourceId),
      ),
    )
    .where(
      and(
        eq(enrollments.tenantId, scope.tenantId),
        eq(enrollments.userId, userId),
        eq(enrollments.sourceKind, 'program'),
      ),
    )
    .orderBy(asc(programs.title));

  const live = mine.filter(
    (program) => !program.expiresAt || program.expiresAt > new Date(),
  );
  if (live.length === 0) return [];

  const members = await scope.tx
    .select({
      programId: programCourses.programId,
      courseId: courses.id,
      title: courses.title,
      slug: courses.slug,
    })
    .from(programCourses)
    .innerJoin(
      courses,
      and(
        eq(courses.tenantId, programCourses.tenantId),
        eq(courses.id, programCourses.courseId),
      ),
    )
    .where(
      and(
        eq(programCourses.tenantId, scope.tenantId),
        inArray(
          programCourses.programId,
          live.map((program) => program.programId),
        ),
        isNull(courses.archivedAt),
      ),
    )
    .orderBy(asc(programCourses.sortOrder));

  const taught = await lessonsOf(
    scope,
    members.map((member) => member.courseId),
  );

  const completed = taught.length
    ? await scope.tx
        .select({ lessonId: progress.lessonId })
        .from(progress)
        .where(
          and(
            eq(progress.tenantId, scope.tenantId),
            eq(progress.userId, userId),
            sql`${progress.completedAt} is not null`,
            inArray(
              progress.lessonId,
              taught.map((lesson) => lesson.id),
            ),
          ),
        )
    : [];

  const done = new Set(completed.map((row) => row.lessonId));

  return live.map((program) => {
    const inProgram = members.filter(
      (member) => member.programId === program.programId,
    );

    const courseRows = inProgram.map((member) => {
      const mineHere = taught.filter(
        (lesson) => lesson.courseId === member.courseId,
      );
      return {
        courseId: member.courseId,
        title: member.title,
        slug: member.slug,
        lessonCount: mineHere.length,
        completedCount: mineHere.filter((lesson) => done.has(lesson.id)).length,
      };
    });

    const total = courseRows.reduce((sum, row) => sum + row.lessonCount, 0);
    const finished = courseRows.reduce(
      (sum, row) => sum + row.completedCount,
      0,
    );

    return {
      programId: program.programId,
      title: program.title,
      slug: program.slug,
      courses: courseRows,
      percent: total === 0 ? 0 : Math.round((finished / total) * 100),
    };
  });
}
