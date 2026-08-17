'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { archiveCourseAction } from '../../../teach/catalog-actions';

/**
 * The one-way door. Shown to admins only: whether the course still exists is
 * not an assigned instructor's call even though editing its content is.
 *
 * The enrolled count is shown before the confirmation, not after, per the
 * round 2 decision: an admin about to take a course away from however many
 * people are on it should see that number before committing, not learn it
 * from a support ticket.
 */
export function ArchiveCourseButton({
  courseId,
  courseTitle,
  enrolledCount,
}: {
  courseId: string;
  courseTitle: string;
  enrolledCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function archive() {
    const warning =
      enrolledCount === 0
        ? `Archive "${courseTitle}"? Nobody is enrolled in it.`
        : `Archive "${courseTitle}"? ${enrolledCount} ${
            enrolledCount === 1 ? 'person is' : 'people are'
          } directly enrolled and will keep their record, but the course ` +
          'disappears from the catalogue and from this list.';

    if (!window.confirm(warning)) return;

    const data = new FormData();
    data.set('courseId', courseId);

    startTransition(async () => {
      const result = await archiveCourseAction(data);
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      router.push('/teach');
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={archive}
        className="text-destructive rounded-md border px-4 py-2 text-sm disabled:opacity-60"
      >
        {pending ? 'Archiving...' : 'Archive this course'}
      </button>
      {enrolledCount > 0 && (
        <span className="text-muted-foreground text-sm">
          {enrolledCount} {enrolledCount === 1 ? 'person' : 'people'} enrolled
        </span>
      )}
      {error && <span className="text-destructive text-sm">{error}</span>}
    </div>
  );
}
