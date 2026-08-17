import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { countCourseEnrollments } from '@/db/repositories/catalog-admin';
import { courseInstructors, courses } from '@/db/schema';
import { can } from '@/lib/access/can';
import { requireViewer } from '@/lib/auth/guards';
import { TeachCourse } from './teach-course';

/**
 * What an instructor may edit (PRD requirement P0-10).
 *
 * The list is built from the same rule the write actions enforce, so the page
 * shows exactly what the predicate would allow rather than showing everything
 * and refusing on submit. An admin sees every course in their institute; an
 * instructor sees the ones they are assigned to and nothing else.
 *
 * A student reaching this URL gets the ordinary 404, because being signed in
 * is not the same as having anything to teach. Decided by `can`, the single
 * vocabulary chunk 1 built for exactly this, rather than the inline role
 * comparison this page used to have (round 2, chunk 4).
 *
 * This is a summary now, not the workspace: title, how many hold it, and one
 * link into the editor. Content, publishing, archiving and reordering all
 * happen at /courses/[courseId]/edit (chunk 3); this page only points there.
 */
export const dynamic = 'force-dynamic';

export default async function TeachPage() {
  const viewer = await requireViewer();

  const verdict = await getTenantDb(viewer.tenant.id).run((scope) =>
    can(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId, role: viewer.role },
      'teach:view',
    ),
  );
  if (!verdict.allowed) notFound();

  const view = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const mine =
      viewer.role === 'admin'
        ? await scope.tx
            .select({ id: courses.id, title: courses.title })
            .from(courses)
            .where(eq(courses.tenantId, scope.tenantId))
            // Ordered, because a list of courses that shuffles between page
            // loads is disorienting for the person using it and makes any test
            // that says "the first course" quietly nondeterministic.
            .orderBy(courses.title)
        : await scope.tx
            .select({ id: courses.id, title: courses.title })
            .from(courses)
            .innerJoin(
              courseInstructors,
              and(
                eq(courseInstructors.tenantId, courses.tenantId),
                eq(courseInstructors.courseId, courses.id),
              ),
            )
            .where(
              and(
                eq(courses.tenantId, scope.tenantId),
                eq(courseInstructors.userId, viewer.userId),
              ),
            )
            .orderBy(courses.title);

    return Promise.all(
      mine.map(async (course) => ({
        ...course,
        enrolledCount: await countCourseEnrollments(scope, course.id),
      })),
    );
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm tracking-wide uppercase">
          {viewer.tenant.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Teaching</h1>
        <p className="text-muted-foreground">
          {viewer.role === 'admin'
            ? 'Every course at this institute.'
            : 'The courses you are assigned to.'}
        </p>
      </header>

      {view.length === 0 ? (
        <p className="text-muted-foreground">
          You are not assigned to any courses yet. An admin can assign you.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {view.map((course) => (
            <TeachCourse key={course.id} course={course} />
          ))}
        </div>
      )}
    </main>
  );
}
