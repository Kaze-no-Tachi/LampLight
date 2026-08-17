'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { addLessonAction, addModuleAction } from './actions';
import { LessonRow, type Lesson } from './lesson-row';

type Module = { id: string; title: string; lessons: Lesson[] };
type Course = { id: string; title: string; modules: Module[] };

export function TeachCourse({ course }: { course: Course }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{course.title}</h2>
        <Link
          href={`/teach/courses/${course.id}`}
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          Edit description and syllabus
        </Link>
      </div>

      {course.modules.map((courseModule) => (
        <ModuleBlock
          key={courseModule.id}
          courseModule={courseModule}
          onError={setError}
        />
      ))}

      <AddModule courseId={course.id} onError={setError} />
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}

function ModuleBlock({
  courseModule,
  onError,
}: {
  courseModule: Module;
  onError: (message: string | null) => void;
}) {
  return (
    <div className="border-muted flex flex-col gap-2 border-l-2 pl-4">
      <h3 className="text-sm font-medium">{courseModule.title}</h3>

      <ul className="flex flex-col gap-2">
        {courseModule.lessons.map((lesson) => (
          <LessonRow key={lesson.id} lesson={lesson} onError={onError} />
        ))}
      </ul>

      <AddLesson moduleId={courseModule.id} onError={onError} />
    </div>
  );
}

function AddModule({
  courseId,
  onError,
}: {
  courseId: string;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set('courseId', courseId);

        startTransition(async () => {
          const result = await addModuleAction(data);
          onError(result.status === 'error' ? result.message : null);
          if (result.status === 'ok') form.reset();
        });
      }}
    >
      <input
        name="title"
        required
        placeholder="New module title"
        className="w-full rounded-md border px-3 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border px-3 py-1 text-sm whitespace-nowrap disabled:opacity-60"
      >
        Add module
      </button>
    </form>
  );
}

function AddLesson({
  moduleId,
  onError,
}: {
  moduleId: string;
  onError: (message: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set('moduleId', moduleId);

        startTransition(async () => {
          const result = await addLessonAction(data);
          onError(result.status === 'error' ? result.message : null);
          if (result.status === 'ok') form.reset();
        });
      }}
    >
      <input
        name="title"
        required
        placeholder="New lesson title"
        className="w-full rounded-md border px-3 py-1 text-sm sm:w-auto sm:flex-1"
      />
      <label className="text-muted-foreground flex items-center gap-1 text-xs">
        <input type="checkbox" name="isFreePreview" />
        Free preview
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border px-3 py-1 text-sm whitespace-nowrap disabled:opacity-60"
      >
        Add lesson
      </button>
    </form>
  );
}
