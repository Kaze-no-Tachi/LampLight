'use client';

import { useState, useTransition } from 'react';
import {
  addLessonAction,
  addModuleAction,
  requestUploadAction,
} from './actions';

type Lesson = { id: string; title: string; isFreePreview: boolean };
type Module = { id: string; title: string; lessons: Lesson[] };
type Course = { id: string; title: string; modules: Module[] };

export function TeachCourse({ course }: { course: Course }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <h2 className="text-lg font-semibold tracking-tight">{course.title}</h2>

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

function LessonRow({
  lesson,
  onError,
}: {
  lesson: Lesson;
  onError: (message: string | null) => void;
}) {
  const [state, setState] = useState<'idle' | 'uploading' | 'done'>('idle');

  /**
   * Upload straight to object storage, not through the application.
   *
   * The server issues a presigned PUT and the browser sends the bytes to the
   * bucket. A lecture recording is tens of megabytes, and routing that through
   * a Next.js route handler means holding it in the application's memory and
   * paying for the bandwidth twice.
   *
   * The key is never sent from here. It is built server-side from the tenant
   * and the resource id, which is what stops an upload landing in another
   * institute's prefix.
   */
  async function upload(file: File) {
    setState('uploading');
    onError(null);

    const request = new FormData();
    request.set('lessonId', lesson.id);
    request.set('filename', file.name);
    request.set('contentType', file.type || 'audio/mpeg');

    const ticket = await requestUploadAction(request);
    if (ticket.status === 'error') {
      onError(ticket.message);
      setState('idle');
      return;
    }

    // The content type has to match what was signed, or the bucket rejects the
    // signature rather than the file, which looks like a permissions problem.
    const response = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': ticket.contentType },
      body: file,
    });

    if (!response.ok) {
      onError(`Upload failed with ${response.status}.`);
      setState('idle');
      return;
    }

    setState('done');
  }

  return (
    <li className="flex flex-wrap items-center gap-3 text-sm">
      <span>{lesson.title}</span>
      {lesson.isFreePreview && (
        <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
          Free preview
        </span>
      )}

      <label className="text-muted-foreground ml-auto cursor-pointer text-xs underline">
        {state === 'uploading'
          ? 'Uploading...'
          : state === 'done'
            ? 'Uploaded'
            : 'Upload audio'}
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
    </li>
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
