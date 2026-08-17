'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  assignInstructorAction,
  removeInstructorAction,
  setPublishedAction,
} from './catalog-actions';

type Staff = { userId: string; email: string; name: string };

type AdminExtras = {
  isPublished: boolean;
  lessonCount: number;
  instructors: Staff[];
  unassignedStaff: Staff[];
};

type Course = {
  id: string;
  title: string;
  enrolledCount: number;
  /**
   * Present for an admin, absent for an instructor: deciding whether a course
   * exists, who teaches it, and whether students can see it is the
   * institute's call, not any one instructor's, the same reasoning
   * settings/catalog/page.tsx used to state before this replaced it
   * (round 2, chunk 5).
   */
  admin?: AdminExtras;
};

/**
 * One assigned course, summarised (round 2, chunk 4), with admin's own
 * catalogue controls folded in (chunk 5): publish state, and who teaches it.
 *
 * Everything this used to render inline, modules and lessons and the audio
 * upload widget among them, moved to /courses/[courseId]/edit in chunk 3.
 * What is left here is what belongs on a list: which course, how many people
 * hold it, whether students can see it, who teaches it, and the one link
 * into the workspace.
 *
 * Grading, Assessments and Roster are not built. They are shown anyway,
 * because a card that only ever offers "Manage lessons" reads as though
 * nothing else is planned, and a link that would 404 is worse than a label
 * that says so honestly.
 */
export function TeachCourse({ course }: { course: Course }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function report(result: { status: 'ok' | 'error'; message?: string }) {
    setError(result.status === 'error' ? (result.message ?? null) : null);
    setMessage(result.status === 'ok' ? (result.message ?? null) : null);
  }

  function togglePublish() {
    if (!course.admin) return;
    const data = new FormData();
    data.set('courseId', course.id);
    data.set('publish', String(!course.admin.isPublished));
    startTransition(async () => report(await setPublishedAction(data)));
  }

  function removeInstructor(userId: string) {
    const data = new FormData();
    data.set('courseId', course.id);
    data.set('userId', userId);
    startTransition(async () => report(await removeInstructorAction(data)));
  }

  function assignInstructor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set('courseId', course.id);
    startTransition(async () => report(await assignInstructorAction(data)));
  }

  return (
    <section
      data-testid="course-card"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            {course.title}
          </h2>
          {course.admin && (
            <span
              className={
                course.admin.isPublished
                  ? 'text-muted-foreground text-xs'
                  : 'text-destructive text-xs'
              }
            >
              {course.admin.isPublished ? 'published' : 'not published'}
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-sm">
          {course.enrolledCount === 1
            ? '1 person enrolled'
            : `${course.enrolledCount} people enrolled`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/courses/${course.id}/edit`}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
        >
          Manage lessons
        </Link>

        {course.admin && (
          <button
            type="button"
            disabled={pending}
            onClick={togglePublish}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-60"
          >
            {course.admin.isPublished ? 'Withdraw' : 'Publish'}
          </button>
        )}

        {/*
          Publishing an empty course is allowed but worth saying out loud: a
          student following a link to nothing is a worse first impression than
          a catalogue that is visibly still being built.
        */}
        {course.admin &&
          !course.admin.isPublished &&
          course.admin.lessonCount === 0 && (
            <span className="text-muted-foreground text-xs">
              No lessons yet. Add some before publishing.
            </span>
          )}
      </div>

      {course.admin && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">Who teaches it</p>
          {course.admin.instructors.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nobody yet. An unassigned course can still be edited by an admin.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {course.admin.instructors.map((person) => (
                <li key={person.userId} className="flex items-center gap-2">
                  <span className="text-sm">
                    {person.name} ({person.email})
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    className="text-destructive text-xs underline disabled:opacity-60"
                    onClick={() => removeInstructor(person.userId)}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {course.admin.unassignedStaff.length > 0 && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={assignInstructor}
            >
              <select
                name="userId"
                className="rounded-md border px-3 py-1 text-sm"
              >
                {course.admin.unassignedStaff.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.name} ({person.email})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border px-3 py-1 text-sm disabled:opacity-60"
              >
                Assign
              </button>
            </form>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <ComingSoon
          title="Grading"
          body="Scoring what students turn in, once assessments exist to score."
        />
        <ComingSoon
          title="Assessments"
          body="Quizzes and exams attached to a lesson or the course as a whole."
        />
        <ComingSoon
          title="Roster"
          body="Who is enrolled here and how they are getting on, from this course's own view."
        />
      </div>

      {message && <p className="text-muted-foreground text-sm">{message}</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-muted text-muted-foreground flex flex-col gap-1 rounded-md border border-dashed p-3 text-sm">
      <span className="text-foreground font-medium">{title}</span>
      <span>Coming soon. {body}</span>
    </div>
  );
}
