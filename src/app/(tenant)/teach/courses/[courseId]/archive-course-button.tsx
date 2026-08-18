'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from 'rsuite';
import { ConfirmModal } from '../../../confirm-modal';
import { archiveCourseAction } from '../../catalog-actions';

/**
 * The one-way door. Shown to admins only: whether the course still exists is
 * not an assigned instructor's call even though editing its content is.
 *
 * The enrolled count is shown before the confirmation, not after, per the
 * round 2 decision: an admin about to take a course away from however many
 * people are on it should see that number before committing, not learn it
 * from a support ticket.
 *
 * Confirmed through rsuite's Modal (round 2, rsuite adoption phase 2) rather
 * than `window.confirm`, so the warning reads like the rest of the app
 * instead of like the browser's own dialog.
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
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function archive() {
    const data = new FormData();
    data.set('courseId', courseId);

    startTransition(async () => {
      const result = await archiveCourseAction(data);
      if (result.status === 'error') {
        setError(result.message);
        setOpen(false);
        return;
      }
      router.push('/teach');
    });
  }

  const warning =
    enrolledCount === 0
      ? `Archive "${courseTitle}"? Nobody is enrolled in it.`
      : `Archive "${courseTitle}"? ${enrolledCount} ${
          enrolledCount === 1 ? 'person is' : 'people are'
        } directly enrolled and will keep their record, but the course ` +
        'disappears from the catalogue and from this list.';

  return (
    <div className="flex items-center gap-3">
      <Button color="red" disabled={pending} onClick={() => setOpen(true)}>
        Archive this course
      </Button>
      {enrolledCount > 0 && (
        <span className="text-muted-foreground text-sm">
          {enrolledCount} {enrolledCount === 1 ? 'person' : 'people'} enrolled
        </span>
      )}
      {error && <span className="text-destructive text-sm">{error}</span>}

      <ConfirmModal
        open={open}
        title="Archive this course?"
        body={warning}
        pending={pending}
        onConfirm={archive}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
