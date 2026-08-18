'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input } from 'rsuite';
import { timecode } from '@/lib/format';
import { ConfirmModal } from './confirm-modal';
import {
  archiveLessonAction,
  reorderLessonAction,
  setLessonPublishedAction,
  updateModuleAction,
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
    <ol className="border-border bg-card overflow-hidden rounded-(--radius) border">
      {lessons.map((lesson, index) => (
        <li
          key={lesson.id}
          className="border-border hover:bg-muted flex items-center gap-4 px-6 py-4 transition-colors not-first:border-t"
        >
          <span className="text-muted-foreground w-6 shrink-0 font-mono text-(length:--text-label)">
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
              className="flex-1 font-serif text-(length:--text-body) leading-snug underline-offset-4 hover:underline"
            >
              {lesson.title}
            </Link>
          ) : (
            // Locked lessons still show their title, dimmed rather than
            // removed. The catalogue is public and the titles are how
            // somebody decides whether to enrol; it is the audio that is
            // gated, and that is gated at issuance.
            <span className="flex-1 font-serif text-(length:--text-body) leading-snug opacity-55">
              {lesson.title}
            </span>
          )}

          {lesson.isFreePreview ? (
            <span className="bg-accent text-accent-foreground shrink-0 rounded-full px-2.5 py-1 text-[0.71875rem] leading-none font-medium whitespace-nowrap">
              Free lesson
            </span>
          ) : !lesson.open ? (
            <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-1 text-[0.71875rem] leading-none font-medium whitespace-nowrap">
              Locked
            </span>
          ) : null}

          {/* Locked rows show no duration: it is one more measurement of what
              is being withheld, and denial here never reads as an error. */}
          <span className="text-muted-foreground w-14 shrink-0 text-right font-mono text-(length:--text-label)">
            {lesson.open ? (timecode(lesson.durationSeconds) ?? '') : ''}
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
  /** Whether a recording is attached, which is not the same as having a duration. */
  hasAudio: boolean;
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

/**
 * What the row says about the recording.
 *
 * A duration and no recording cannot happen, but a recording and no duration
 * can: the length is read from the file by the browser that uploaded it, and
 * an unusual codec it could not decode leaves the lesson with audio and no
 * number. Saying "no audio" there would send somebody looking for a file that
 * is already attached.
 */
function audioLine(lesson: StaffLesson): { text: string; missing: boolean } {
  if (!lesson.hasAudio) return { text: 'no audio', missing: true };
  const length = timecode(lesson.durationSeconds);
  return { text: length ?? 'audio attached', missing: false };
}

function StaffLessonRow({
  lesson,
  number,
}: {
  lesson: StaffLesson;
  number: number;
}) {
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

  const audio = audioLine(lesson);

  return (
    <li className="bg-muted flex flex-col gap-1 rounded-(--radius) px-3.5 py-[11px]">
      <div className="flex flex-wrap items-center gap-3.5">
        {/* The arrows come first and stay narrow: they are the control
            somebody uses least and would push the title around most. */}
        <div className="flex flex-col leading-none">
          <button
            type="button"
            disabled={pending || lesson.isFirst}
            onClick={() => reorder('up')}
            aria-label={`Move ${lesson.title} up`}
            className="text-muted-foreground cursor-pointer text-[0.625rem] leading-none disabled:cursor-default disabled:opacity-30"
          >
            &#9650;
          </button>
          <button
            type="button"
            disabled={pending || lesson.isLast}
            onClick={() => reorder('down')}
            aria-label={`Move ${lesson.title} down`}
            className="text-muted-foreground cursor-pointer text-[0.625rem] leading-none disabled:cursor-default disabled:opacity-30"
          >
            &#9660;
          </button>
        </div>

        <span className="text-muted-foreground shrink-0 font-mono text-(length:--text-meta)">
          {String(number).padStart(2, '0')}
        </span>

        <Link
          href={`/teach/lessons/${lesson.id}`}
          className="min-w-40 flex-1 text-(length:--text-ui) underline-offset-4 hover:underline"
        >
          {lesson.title}
        </Link>

        <span
          className={`shrink-0 text-(length:--text-meta) whitespace-nowrap ${
            audio.missing ? 'text-muted-foreground italic' : 'font-mono'
          }`}
        >
          {audio.text}
        </span>

        {/* Two different facts, two pills. Whether a lesson is finished and
            who may hear it are decided separately, and a course full of
            drafts that are also open to everyone is a normal state. */}
        {!lesson.isPublished && (
          <span className="border-border text-muted-foreground shrink-0 rounded-full border px-2.5 py-1 text-[0.71875rem] leading-none font-medium whitespace-nowrap">
            Draft
          </span>
        )}
        <span className="bg-accent text-accent-foreground shrink-0 rounded-full px-2.5 py-1 text-[0.71875rem] leading-none font-medium whitespace-nowrap">
          {lesson.isFreePreview ? 'Open to all' : 'Enrolled only'}
        </span>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={publish}
            className="cursor-pointer text-(length:--text-label) font-medium underline underline-offset-[3px] disabled:opacity-60"
          >
            {lesson.isPublished ? 'Withdraw' : 'Publish'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmingArchive(true)}
            className="text-muted-foreground cursor-pointer text-(length:--text-label) font-medium underline underline-offset-[3px] disabled:opacity-60"
          >
            Archive
          </button>
          <Link
            href={`/teach/lessons/${lesson.id}`}
            className="text-(length:--text-label) font-medium underline underline-offset-[3px]"
          >
            Edit
          </Link>
        </div>
      </div>
      {error && (
        <p className="text-destructive text-(length:--text-meta)">{error}</p>
      )}

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

/**
 * One section, with its lessons under it (mockup 9).
 *
 * Expanded by default, unlike the mockup, which draws every section shut. A
 * collapsed list is right for reading a syllabus and wrong for working
 * through one: the reason to open this screen is usually a specific lesson,
 * and hiding all of them behind a caret adds a click before any work starts.
 * Collapsing is still there for the course with eight sections.
 */
function StaffModuleSection({ section }: { section: StaffModule }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const waiting = section.lessons.filter(
    (lesson) => !lesson.hasAudio && lesson.isPublished,
  ).length;

  const meta = [
    section.lessons.length === 1
      ? '1 lesson'
      : `${section.lessons.length} lessons`,
    ...(waiting > 0 ? [`${waiting} waiting on audio`] : []),
  ].join(' \u00b7 ');

  function rename() {
    if (renaming === null) return;
    const data = new FormData();
    data.set('moduleId', section.id);
    data.set('title', renaming);

    startTransition(async () => {
      const result = await updateModuleAction(data);
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      setError(null);
      setRenaming(null);
      router.refresh();
    });
  }

  return (
    <div className="border-border flex flex-col border-t">
      <div className="flex flex-wrap items-center gap-3.5 py-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="text-muted-foreground w-3.5 cursor-pointer text-(length:--text-meta)"
        >
          {open ? '\u25be' : '\u25b8'}
        </button>

        {renaming === null ? (
          <>
            <span className="flex-1 text-(length:--text-body)">
              {section.title}
            </span>
            <span className="text-muted-foreground text-(length:--text-label) whitespace-nowrap">
              {meta}
            </span>
            <button
              type="button"
              onClick={() => setRenaming(section.title)}
              className="text-muted-foreground cursor-pointer text-(length:--text-label) font-medium underline underline-offset-[3px]"
            >
              Rename
            </button>
          </>
        ) : (
          <div className="flex flex-1 flex-wrap items-center gap-2.5">
            <div className="min-w-52 flex-1">
              <Input
                value={renaming}
                onChange={(next: string) => setRenaming(next)}
                aria-label={`Rename ${section.title}`}
              />
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={rename}
              className="border-border hover:border-primary cursor-pointer rounded-(--radius) border px-[13px] py-[9px] text-(length:--text-label) font-medium disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setRenaming(null)}
              className="text-muted-foreground cursor-pointer text-(length:--text-label) font-medium underline underline-offset-[3px]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-destructive pb-2 text-(length:--text-meta)">
          {error}
        </p>
      )}

      {open && (
        <ul className="flex flex-col gap-1.5 pt-0.5 pb-4 pl-[30px]">
          {section.lessons.length === 0 ? (
            <li className="text-muted-foreground text-(length:--text-label)">
              Nothing in this section yet.
            </li>
          ) : (
            section.lessons.map((lesson, index) => (
              <StaffLessonRow
                key={lesson.id}
                lesson={lesson}
                number={index + 1}
              />
            ))
          )}
        </ul>
      )}
    </div>
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
      <p className="text-muted-foreground text-(length:--text-ui)">
        None yet. Add the first one above, then open it to attach the recording
        and any handouts.
      </p>
    );
  }

  // Sections are an advanced feature that most courses never use, so they
  // only appear once there is more than one to tell apart. A course with a
  // single section reads as a plain list of lessons, which is what it is.
  if (!showModuleHeadings) {
    const only = modules.flatMap((courseModule) => courseModule.lessons);
    return (
      <ul className="flex flex-col gap-1.5">
        {only.map((lesson, index) => (
          <StaffLessonRow key={lesson.id} lesson={lesson} number={index + 1} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col">
      {modules.map((courseModule) => (
        <StaffModuleSection key={courseModule.id} section={courseModule} />
      ))}
    </div>
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
