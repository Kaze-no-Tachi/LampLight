'use client';

import { useState, useTransition } from 'react';
import { Button, Modal } from 'rsuite';
import { addLessonToCourseAction } from '../../actions';

/**
 * Adding a lesson, from the course you are already looking at.
 *
 * The old path was: go to the teaching list, add a section, come back, find
 * the section, add a lesson to it. Three screens and a concept ("sections")
 * that an institute writing its first course has no use for. This is one
 * button on the page the lessons are listed on.
 *
 * rsuite's Modal (round 2, rsuite adoption phase 2), replacing a native
 * `<dialog>`: see docs/plans/rsuite-adoption.md for what that adoption is
 * and why the dialogs moved first.
 */
export function AddLessonDialog({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button
        appearance="primary"
        className="self-start"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Add lesson
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} size="sm">
        <Modal.Header>
          <Modal.Title>Add a lesson</Modal.Title>
        </Modal.Header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            data.set('courseId', courseId);

            startTransition(async () => {
              const result = await addLessonToCourseAction(data);
              if (result.status === 'error') {
                setError(result.message ?? 'That did not work.');
                return;
              }
              setError(null);
              form.reset();
              setOpen(false);
            });
          }}
        >
          <Modal.Body>
            <div className="flex flex-col gap-3">
              <input
                name="title"
                required
                autoFocus
                placeholder="What the lesson is called"
                className="rounded-md border px-3 py-2"
              />

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isFreePreview" />
                Anybody can listen to this one, signed in or not
              </label>

              <p className="text-muted-foreground text-sm">
                You add the recording and any handouts on the lesson itself,
                once it exists.
              </p>

              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" appearance="primary" loading={pending}>
              Add lesson
            </Button>
          </Modal.Footer>
        </form>
      </Modal>
    </>
  );
}
