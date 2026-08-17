'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  assignInstructorAction,
  createCourseAction,
  createProgramAction,
  removeInstructorAction,
  setProgramCoursesAction,
  setProgramPublishedAction,
  setPublishedAction,
  type CatalogResult,
} from './actions';
import type {
  AdminCourse,
  AdminProgram,
} from '@/db/repositories/catalog-admin';

type Staff = { userId: string; email: string; name: string };

/** Every form here reports in the same place, so nothing fails silently. */
function useAction() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CatalogResult | null>(null);

  const run = (
    action: (data: FormData) => Promise<CatalogResult>,
    data: FormData,
    onDone?: () => void,
  ) => {
    startTransition(async () => {
      const outcome = await action(data);
      setResult(outcome);
      if (outcome.status === 'ok') onDone?.();
    });
  };

  return { pending, result, run };
}

function Report({ result }: { result: CatalogResult | null }) {
  if (!result) return null;
  return (
    <p
      className={
        result.status === 'error'
          ? 'text-destructive text-sm'
          : 'text-muted-foreground text-sm'
      }
    >
      {result.message ?? 'Saved.'}
    </p>
  );
}

export function NewCourseForm() {
  const { pending, result, run } = useAction();

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        run(createCourseAction, new FormData(form), () => form.reset());
      }}
    >
      <h3 className="font-medium">Add a course</h3>
      <input
        name="title"
        required
        placeholder="Old Testament Survey"
        className="rounded-md border px-3 py-2"
      />
      <input
        name="slug"
        placeholder="Web address (optional, made from the title)"
        className="rounded-md border px-3 py-2 font-mono text-sm"
      />
      <textarea
        name="description"
        rows={2}
        placeholder="What it covers (optional, markdown)"
        className="rounded-md border px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground self-start rounded-md px-4 py-2 disabled:opacity-60"
      >
        {pending ? 'Creating...' : 'Create course'}
      </button>
      <Report result={result} />
    </form>
  );
}

export function NewProgramForm() {
  const { pending, result, run } = useAction();

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        run(createProgramAction, new FormData(form), () => form.reset());
      }}
    >
      <h3 className="font-medium">Add a program</h3>
      <p className="text-muted-foreground text-sm">
        A group of courses, enrolled in and sold as one thing.
      </p>
      <input
        name="title"
        required
        placeholder="Certificate in Ministry"
        className="rounded-md border px-3 py-2"
      />
      <input
        name="slug"
        placeholder="Web address (optional)"
        className="rounded-md border px-3 py-2 font-mono text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground self-start rounded-md px-4 py-2 disabled:opacity-60"
      >
        {pending ? 'Creating...' : 'Create program'}
      </button>
      <Report result={result} />
    </form>
  );
}

export function CourseRow({
  course,
  staff,
}: {
  course: AdminCourse;
  staff: Staff[];
}) {
  const { pending, result, run } = useAction();

  const unassigned = staff.filter(
    (person) => !course.instructors.some((i) => i.userId === person.userId),
  );

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium">{course.title}</h3>
        <span className="text-muted-foreground font-mono text-xs">
          /catalogue/{course.slug}
        </span>
        <span
          className={
            course.isPublished
              ? 'text-muted-foreground text-xs'
              : 'text-destructive text-xs'
          }
        >
          {course.isPublished ? 'published' : 'not published'}
        </span>
        <span className="text-muted-foreground text-xs">
          {course.lessonCount === 1
            ? '1 lesson'
            : `${course.lessonCount} lessons`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/teach/courses/${course.id}`}
          className="text-sm underline underline-offset-4"
        >
          Edit content
        </Link>

        <button
          type="button"
          disabled={pending}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-60"
          onClick={() => {
            const data = new FormData();
            data.set('courseId', course.id);
            data.set('publish', String(!course.isPublished));
            run(setPublishedAction, data);
          }}
        >
          {course.isPublished ? 'Withdraw' : 'Publish'}
        </button>

        {/*
          Publishing an empty course is allowed but worth saying out loud: a
          student following a link to nothing is a worse first impression than
          a catalogue that is visibly still being built.
        */}
        {!course.isPublished && course.lessonCount === 0 && (
          <span className="text-muted-foreground text-xs">
            No lessons yet. Add some before publishing.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Who teaches it</p>
        {course.instructors.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody yet. An unassigned course can still be edited by an admin.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {course.instructors.map((person) => (
              <li key={person.userId} className="flex items-center gap-2">
                <span className="text-sm">
                  {person.name} ({person.email})
                </span>
                <button
                  type="button"
                  disabled={pending}
                  className="text-destructive text-xs underline disabled:opacity-60"
                  onClick={() => {
                    const data = new FormData();
                    data.set('courseId', course.id);
                    data.set('userId', person.userId);
                    run(removeInstructorAction, data);
                  }}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {unassigned.length > 0 && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set('courseId', course.id);
              run(assignInstructorAction, data);
            }}
          >
            <select
              name="userId"
              className="rounded-md border px-3 py-1 text-sm"
            >
              {unassigned.map((person) => (
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

      <Report result={result} />
    </li>
  );
}

export function ProgramRow({
  program,
  courses,
}: {
  program: AdminProgram;
  courses: AdminCourse[];
}) {
  const { pending, result, run } = useAction();

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium">{program.title}</h3>
        <span className="text-muted-foreground font-mono text-xs">
          {program.slug}
        </span>
        <span
          className={
            program.isPublished
              ? 'text-muted-foreground text-xs'
              : 'text-destructive text-xs'
          }
        >
          {program.isPublished ? 'published' : 'not published'}
        </span>
      </div>

      <button
        type="button"
        disabled={pending}
        className="self-start rounded-md border px-3 py-1 text-sm disabled:opacity-60"
        onClick={() => {
          const data = new FormData();
          data.set('programId', program.id);
          data.set('publish', String(!program.isPublished));
          run(setProgramPublishedAction, data);
        }}
      >
        {program.isPublished ? 'Withdraw' : 'Publish'}
      </button>

      {courses.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Create a course first, then choose which ones belong here.
        </p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set('programId', program.id);
            run(setProgramCoursesAction, data);
          }}
        >
          <p className="text-muted-foreground text-sm">
            Courses in this program
          </p>
          {courses.map((course) => (
            <label key={course.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="courseId"
                value={course.id}
                defaultChecked={program.courseIds.includes(course.id)}
              />
              {course.title}
            </label>
          ))}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border px-3 py-1 text-sm self-start disabled:opacity-60"
          >
            Save courses
          </button>
        </form>
      )}

      <Report result={result} />
    </li>
  );
}
