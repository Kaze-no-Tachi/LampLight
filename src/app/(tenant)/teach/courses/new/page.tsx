import { getTenantDb } from '@/db/client';
import { listCourseTags } from '@/db/repositories/catalog';
import { listAssignableStaff } from '@/db/repositories/catalog-admin';
import { requireRole } from '@/lib/auth/guards';
import { NewCourse } from './new-course';

/**
 * Starting a course (mockup 7).
 *
 * A page rather than the four-field form that used to sit inline on /teach.
 * What a course is called, what it is about, who teaches it, what it is filed
 * under and how it is sold is more than a list header has room for, and every
 * one of those is easier to decide once, here, than to come back for.
 *
 * Admin only, the same as every other "does this exist" decision: an
 * instructor writes the courses they are assigned to and does not decide what
 * the institute teaches. requireRole is the gate, and createCourseAction asks
 * again on submit, because the page deciding what to render is not
 * authorization.
 *
 * Statically routed above /teach/courses/[courseId], so "new" is never read as
 * a course id.
 */
export const dynamic = 'force-dynamic';

export default async function NewCoursePage() {
  const viewer = await requireRole('admin');

  const { tags, staff } = await getTenantDb(viewer.tenant.id).run(
    async (scope) => ({
      tags: await listCourseTags(scope),
      staff: await listAssignableStaff(scope),
    }),
  );

  return (
    <NewCourse
      // The host this request actually arrived on, so the address line shows
      // the institute's own domain rather than a guess assembled from the
      // platform apex.
      host={viewer.tenant.host}
      tags={tags.map((tag) => tag.label)}
      staff={staff.map((person) => ({
        userId: person.userId,
        name: person.name,
        email: person.email,
      }))}
    />
  );
}
