'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ConfirmModal } from './confirm-modal';
import {
  archiveLessonAction,
  reorderLessonAction,
  setLessonPublishedAction,
} from './teach/edit-actions';

/**
 * The lesson list, in the one place it now lives (round 2, chunk 3).
 *
 * There used to be three of these: a plain `<ol>` on the public course page,
 * inline JSX in the old per-course editor, and `LessonRow` in
 * `teach/lesson-row.tsx` (which still exists, for the audio upload widget it
 * also does, unrelated to listing). One component, role-driven, so a change
 * to how a lesson row reads only has to happen once.
 *
 * Student mode is read-only: a lesson is either a link, because the predicate
 * already decided this viewer may open it, or locked text. Staff mode is
 * where the writes are: Edit, Publish or Withdraw, Archive, and reordering
 * within the lesson's own module. `can` is not asked again here; the page
 * that renders this already asked it once to decide which mode to pass, and
 * every action re-asks its own predicate before doing anything, exactly as
 * every other action in this codebase does.
 */

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

/** Shared with teach/lesson-row.tsx (round 2, chunk 5). */
export function FreePreviewBadge() {
  return (
    <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
      Free preview
    </span>
  );
}

export type StudentLesson = {
  id: string;
  title: string;
  isFreePreview: boolean;
  durationSeconds: number | null;
  /** Whether the access predicate already granted this viewer the lesson. */
  open: boolean;
};

function StudentLessonList({ lessons }: { lessons: StudentLesson[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {lessons.map((lesson, index) => (
        <li
          key={lesson.id}
          className="flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <span className="flex items-baseline gap-3">
            <span className="text-muted-foreground font-mono text-sm">
              {String(index + 1).padStart(2, '0')}
            </span>
            {lesson.open ? (
              // Open lessons are underlined rather than only being links.
              // Without a visible affordance the two states render almost
              // identically, and a student cannot tell what they may click
              // from what they may not, which is the one thing this page
              // exists to communicate.
              <Link
                href={`/lessons/${lesson.id}`}
                className="decoration-muted-foreground/40 font-medium underline underline-offset-4 hover:decoration-current"
              >
                {lesson.title}
              </Link>
            ) : (
              // Locked lessons still show their title. The catalogue is
              // public and the titles are how somebody decides whether to
              // enrol; it is the audio that is gated, and that is gated at
              // issuance.
              <span className="text-muted-foreground">{lesson.title}</span>
            )}
          </span>

          <span className="text-muted-foreground flex items-center gap-2 text-xs whitespace-nowrap">
            {lesson.isFreePreview && <FreePreviewBadge />}
            {lesson.open ? (
              formatDuration(lesson.durationSeconds)
            ) : (
              <span aria-label="Locked" title="Locked">
                Locked
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export type StaffLesson = {
  id: string;
  title: string;
  isFreePreview: boolean;
  isPublished: boolean;
  durationSeconds: number | null;
  /** Disables the up button: nothing left to swap with in this module. */
  isFirst: boolean;
  /** Disables the down button. */
  isLast: boolean;
};

export type StaffModule = {
  id: string;
  title: string;
  lessons: StaffLesson[];
};

function StaffLessonRow({ lesson }: { lesson: StaffLesson }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  function publish() {
    const data = new FormData();
    data.set('lessonId', lesson.id);
    data.set('isPublished', String(!lesson.isPublished));

    startTransition(async () => {
      const result = await setLessonPublishedAction(data);
      setError(result.status === 'error' ? result.message : null);
      if (result.status === 'ok') router.refresh();
    });
  }

  function archive() {
    const data = new FormData();
    data.set('lessonId', lesson.id);

    startTransition(async () => {
      const result = await archiveLessonAction(data);
      setError(result.status === 'error' ? result.message : null);
      setConfirmingArchive(false);
      if (result.status === 'ok') router.refresh();
    });
  }

  function reorder(direction: 'up' | 'down') {
    const data = new FormData();
    data.set('lessonId', lesson.id);
    data.set('direction', direction);

    startTransition(async () => {
      const result = await reorderLessonAction(data);
      setError(result.status === 'error' ? result.message : null);
      if (result.status === 'ok') router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-1 border-b py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex flex-col">
          <button
            type="button"
            disabled={pending || lesson.isFirst}
            onClick={() => reorder('up')}
            aria-label={`Move ${lesson.title} up`}
            className="text-muted-foreground leading-none disabled:opacity-30"
          >
            ▲
          </button>
          <button
            type="button"
            disabled={pending || lesson.isLast}
            onClick={() => reorder('down')}
            aria-label={`Move ${lesson.title} down`}
            className="text-muted-foreground leading-none disabled:opacity-30"
          >
            ▼
          </button>
        </div>

        <Link
          href={`/teach/lessons/${lesson.id}`}
          className="underline-offset-4 hover:underline"
        >
          {lesson.title}
        </Link>
        {lesson.isFreePreview && <FreePreviewBadge />}
        <span
          className={
            lesson.isPublished
              ? 'text-muted-foreground text-xs'
              : 'text-destructive text-xs'
          }
        >
          {lesson.isPublished ? 'published' : 'draft'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={publish}
            className="rounded-md border px-2 py-1 text-xs disabled:opacity-60"
          >
            {lesson.isPublished ? 'Unpublish' : 'Publish'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmingArchive(true)}
            className="text-destructive rounded-md border px-2 py-1 text-xs disabled:opacity-60"
          >
            Archive
          </button>
        </div>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}

      <ConfirmModal
        open={confirmingArchive}
        title="Archive this lesson?"
        body={`Archive "${lesson.title}"? This cannot be undone from here.`}
        pending={pending}
        onConfirm={archive}
        onCancel={() => setConfirmingArchive(false)}
      />
    </li>
  );
}

function StaffLessonList({
  modules,
  showModuleHeadings,
}: {
  modules: StaffModule[];
  showModuleHeadings: boolean;
}) {
  if (modules.every((courseModule) => courseModule.lessons.length === 0)) {
    return (
      <p className="text-muted-foreground text-sm">
        None yet. Add the first one above, then open it to attach the recording
        and any handouts.
      </p>
    );
  }

  return (
    <>
      {modules.map((courseModule) => (
        <div key={courseModule.id} className="flex flex-col gap-1">
          {/* Sections are an advanced feature that most courses never use, so
              the heading only appears once there is more than one to tell
              apart. A course with a single section reads as a plain list of
              lessons, which is what it is. */}
          {showModuleHeadings && (
            <h3 className="text-sm font-medium">{courseModule.title}</h3>
          )}
          <ul className="flex flex-col">
            {courseModule.lessons.map((lesson) => (
              <StaffLessonRow key={lesson.id} lesson={lesson} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export type LessonListProps =
  | { mode: 'student'; lessons: StudentLesson[] }
  | { mode: 'staff'; modules: StaffModule[]; showModuleHeadings: boolean };

export function LessonList(props: LessonListProps) {
  if (props.mode === 'student') {
    return <StudentLessonList lessons={props.lessons} />;
  }
  return (
    <StaffLessonList
      modules={props.modules}
      showModuleHeadings={props.showModuleHeadings}
    />
  );
}
