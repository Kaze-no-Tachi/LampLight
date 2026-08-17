'use server';

import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { can } from '@/lib/access/can';
import { requireViewer } from '@/lib/auth/guards';
import { enrollSelf } from '@/lib/entitlements/grants';

/**
 * A member enrolling themselves in a published course from the catalogue.
 *
 * Every action re-establishes the viewer through requireViewer and takes the
 * tenant from the resolved Host header, matching the rest of the app: a
 * server action is a public endpoint that happens to be called from a page.
 *
 * The button that calls this only ever renders for a signed-in member who is
 * not yet enrolled, but that is the page deciding what to show, not an
 * authorization. `can` is asked again here, which is the call that matters.
 */
export type EnrollResult =
  { status: 'ok' } | { status: 'error'; message: string };

export async function enrollAction(
  courseId: string,
  slug: string,
): Promise<EnrollResult> {
  const viewer = await requireViewer();

  const verdict = await getTenantDb(viewer.tenant.id).run((scope) =>
    can(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId, role: viewer.role },
      'course:enroll',
      { kind: 'course', id: courseId },
    ),
  );

  if (!verdict.allowed) {
    return {
      status: 'error',
      message:
        verdict.reason === 'already-enrolled'
          ? 'You are already enrolled in this course.'
          : 'That course is not open for enrolment.',
    };
  }

  const outcome = await enrollSelf({
    tenantId: viewer.tenant.id,
    userId: viewer.userId,
    courseId,
  });

  if (outcome.status === 'error') {
    return { status: 'error', message: outcome.message };
  }
  if (outcome.status === 'already') {
    return {
      status: 'error',
      message: 'You are already enrolled in this course.',
    };
  }

  revalidatePath('/courses');
  revalidatePath(`/catalogue/${slug}`);
  return { status: 'ok' };
}
