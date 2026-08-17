'use client';

import { useRef, useState, useTransition } from 'react';
import { addLessonToCourseAction } from '../../../teach/actions';

/**
 * Adding a lesson, from the course you are already looking at.
 *
 * The old path was: go to the teaching list, add a section, come back, find
 * the section, add a lesson to it. Three screens and a concept ("sections")
 * that an institute writing its first course has no use for. This is one
 * button on the page the lessons are listed on.
 *
 * A native <dialog> rather than a modal library. It gets focus trapping, Escape
 * to close, and the backdrop from the browser, and it is the whole feature.
 */
export function AddLessonDialog({ courseId }: { courseId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className="bg-primary text-primary-foreground self-start rounded-md px-4 py-2 text-sm"
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
      >
        Add lesson
      </button>

      <dialog
        ref={dialog}
        className="bg-card text-foreground w-full max-w-md rounded-lg border p-6 backdrop:bg-black/40"
      >
        <form
          className="flex flex-col gap-3"
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
              dialog.current?.close();
            });
          }}
        >
          <h2 className="text-lg font-medium">Add a lesson</h2>

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
            You add the recording and any handouts on the lesson itself, once it
            exists.
          </p>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-60"
            >
              {pending ? 'Adding...' : 'Add lesson'}
            </button>
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
