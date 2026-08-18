import { and, eq, isNull, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { courses, lessons, modules } from '@/db/schema';
import { decideCourseAuthoring } from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import { NewLesson } from './new-lesson';

/**
 * Adding a lesson (mockup 8).
 *
 * A page rather than the modal it replaces. The modal held a title and a
 * checkbox, which was the right size for what it could do and the wrong size
 * for what adding a lesson actually involves: the recording is the reason the
 * lesson exists, and putting it behind a second screen means the common act of
 * "here is the file I just finished editing" takes two navigations.
 *
 * The predicate decides, not the route, and it is asked about the course
 * rather than about the person: an instructor assigned to this course may add
 * to it, an admin may add to any of them, and anyone else gets the same 404 as
 * a course id that does not exist.
 */
export const dynamic = 'force-dynamic';

export default async function NewLessonPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const viewer = await requireViewer();
  const { courseId } = await params;

  const data = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return null;

    const [course] = await scope.tx
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(
        and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)),
      )
      .limit(1);

    if (!course) return null;

    // Counted here rather than in the page, so a course with a dozen sections
    // still costs one query. Archived lessons are left out: the count is what
    // the section holds, and an archived lesson is not in it any more.
    const courseModules = await scope.tx
      .select({
        id: modules.id,
        title: modules.title,
        lessonCount: sql<number>`count(${lessons.id})::int`,
      })
      .from(modules)
      .leftJoin(
        lessons,
        and(
          eq(lessons.tenantId, modules.tenantId),
          eq(lessons.moduleId, modules.id),
          isNull(lessons.archivedAt),
        ),
      )
      .where(
        and(
          eq(modules.tenantId, scope.tenantId),
          eq(modules.courseId, courseId),
        ),
      )
      .groupBy(modules.id, modules.title, modules.sortOrder)
      .orderBy(modules.sortOrder);

    return { course, courseModules };
  });

  if (!data) notFound();

  return (
    <NewLesson
      course={data.course}
      sections={data.courseModules.map((courseModule) => ({
        id: courseModule.id,
        title: courseModule.title,
        lessonCount: courseModule.lessonCount,
      }))}
    />
  );
}
