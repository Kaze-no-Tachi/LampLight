'use client';

import { useState, useTransition } from 'react';
import { Markdown } from '@/lib/markdown/render';
import { Attachments } from '../../attachments';
import { addCourseLinkAction, updateCourseAction } from '../../edit-actions';

type Resource = {
  id: string;
  kind: 'audio' | 'video' | 'pdf' | 'link';
  title: string;
  isPublic: boolean;
  byteSize: number | null;
  filename: string | null;
  url: string | null;
};

/**
 * What a course says, and what comes with it.
 *
 * The description is markdown, so there is a preview: the subset the renderer
 * supports is small and an institute typing into a box has no other way to
 * find out what will happen to their asterisks.
 */
export function CourseEditor({
  course,
  resources,
}: {
  course: { id: string; title: string; descriptionMd: string | null };
  resources: Resource[];
}) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.descriptionMd ?? '');
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const data = new FormData();
    data.set('courseId', course.id);
    data.set('title', title);
    data.set('descriptionMd', description);

    startTransition(async () => {
      const result = await updateCourseAction(data);
      setError(result.status === 'error' ? result.message : null);
      setMessage(result.status === 'ok' ? 'Saved.' : null);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Course title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-md border px-3 py-2"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between">
            <label htmlFor="course-description">Description</label>
            <button
              type="button"
              onClick={() => setPreview((current) => !current)}
              className="text-muted-foreground text-xs underline"
            >
              {preview ? 'Back to editing' : 'Preview'}
            </button>
          </div>

          {preview ? (
            <div className="min-h-40 rounded-md border px-3 py-2">
              <Markdown source={description} />
            </div>
          ) : (
            <textarea
              id="course-description"
              rows={10}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                '## About this course\n\nWhat it covers, and who it is for.'
              }
              className="rounded-md border px-3 py-2 font-mono text-xs"
            />
          )}

          <span className="text-muted-foreground text-xs">
            Headings with ##, **bold**, *italic*, lists with -, and
            [links](https://example.edu). Anything else is shown as you typed
            it.
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-60"
          >
            {pending ? 'Saving...' : 'Save course'}
          </button>
          {message && <span className="text-sm">{message}</span>}
          {error && <span className="text-destructive text-sm">{error}</span>}
        </div>
      </section>

      <Attachments
        target={{ kind: 'course', id: course.id }}
        addLink={addCourseLinkAction}
        title="Syllabus and handouts"
        description="Anything marked open to everyone shows on the course page before somebody enrols, which is what a syllabus is for. The rest is for enrolled students."
        showVisibility
        attachments={resources.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          label: resource.title,
          byteSize: resource.byteSize,
          url: resource.url,
          isPublic: resource.isPublic,
        }))}
      />
    </div>
  );
}
