'use client';

import { useState, useTransition } from 'react';
import type {
  AdminCourse,
  AdminProgram,
} from '@/db/repositories/catalog-admin';
import {
  createProgramAction,
  setProgramCoursesAction,
  setProgramPublishedAction,
  type CatalogResult,
} from './catalog-actions';

/**
 * Program creation, publishing, and course membership. Admin only, moved
 * from settings/catalog/catalog-forms.tsx (round 2, chunk 5): a program is
 * still a different sellable unit from a course, with no editor of its own,
 * so its whole lifecycle lives here rather than being split across pages.
 */

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
