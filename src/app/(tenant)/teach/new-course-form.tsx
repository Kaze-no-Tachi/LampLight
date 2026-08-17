'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createCourseAction } from './catalog-actions';

/**
 * Creating a course lands in its editor, not back on this list (round 2
 * decision): there is nothing to do with a brand new, empty course from here
 * anyway, and the editor is where lessons actually get added. Moved from
 * settings/catalog/catalog-forms.tsx (chunk 5): admin-only, and admin already
 * sees every course at this institute here.
 */
export function NewCourseForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);

        startTransition(async () => {
          const result = await createCourseAction(data);
          if (result.status === 'error') {
            setError(result.message);
            return;
          }
          setError(null);
          router.push(`/courses/${result.courseId}/edit`);
        });
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
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}
