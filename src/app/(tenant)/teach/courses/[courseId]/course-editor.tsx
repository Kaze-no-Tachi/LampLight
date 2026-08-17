'use client';

import { useRef, useState, useTransition } from 'react';
import { Markdown } from '@/lib/markdown/render';
import { checkUpload } from '@/lib/media/uploads';
import {
  addCourseLinkAction,
  completeDocumentUploadAction,
  removeCourseResourceAction,
  requestDocumentUploadAction,
  updateCourseAction,
} from '../../edit-actions';

type Resource = {
  id: string;
  kind: 'audio' | 'video' | 'pdf' | 'link';
  title: string;
  isPublic: boolean;
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

      <Documents courseId={course.id} resources={resources} />
    </div>
  );
}

/**
 * The syllabus and anything else that comes with the course.
 *
 * Two ways in, because institutes differ: upload a PDF, or point at something
 * that already lives on their own site. The link path also means an institute
 * whose operator has not configured storage can still publish a syllabus.
 */
function Documents({
  courseId,
  resources,
}: {
  courseId: string;
  resources: Resource[];
}) {
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'checking'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function addLink() {
    const data = new FormData();
    data.set('courseId', courseId);
    data.set('title', linkTitle);
    data.set('url', linkUrl);
    data.set('isPublic', String(isPublic));

    startTransition(async () => {
      const result = await addCourseLinkAction(data);
      setError(result.status === 'error' ? result.message : null);
      if (result.status === 'ok') {
        setLinkTitle('');
        setLinkUrl('');
      }
    });
  }

  async function upload(file: File) {
    setError(null);

    const check = checkUpload({
      kind: 'document',
      contentType: file.type,
      byteSize: file.size,
    });
    if (!check.ok) {
      setError(check.message);
      return;
    }

    setPhase('sending');

    const request = new FormData();
    request.set('courseId', courseId);
    request.set('title', linkTitle || file.name);
    request.set('filename', file.name);
    request.set('contentType', file.type);
    request.set('byteSize', String(file.size));
    request.set('isPublic', String(isPublic));

    const ticket = await requestDocumentUploadAction(request);
    if (ticket.status === 'error') {
      setError(ticket.message);
      setPhase('idle');
      return;
    }

    const response = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': ticket.contentType },
      body: file,
    });

    if (!response.ok) {
      setError(`The bucket answered ${response.status}.`);
      setPhase('idle');
      return;
    }

    setPhase('checking');

    const done = new FormData();
    done.set('courseId', courseId);
    done.set('resourceId', ticket.resourceId);
    const confirmed = await completeDocumentUploadAction(done);

    setPhase('idle');
    setLinkTitle('');
    if (fileRef.current) fileRef.current.value = '';
    if (confirmed.status === 'error') setError(confirmed.message);
  }

  function remove(resourceId: string) {
    const data = new FormData();
    data.set('courseId', courseId);
    data.set('resourceId', resourceId);

    startTransition(async () => {
      const result = await removeCourseResourceAction(data);
      setError(result.status === 'error' ? result.message : null);
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Syllabus and handouts</h2>
        <p className="text-muted-foreground text-sm">
          Anything marked open to everyone shows on the course page before
          somebody enrols, which is what a syllabus is for. The rest is for
          enrolled students.
        </p>
      </div>

      {resources.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {resources.map((resource) => (
            <li
              key={resource.id}
              className="flex items-center gap-3 border-b py-2"
            >
              <span className="truncate">{resource.title}</span>
              <span className="text-muted-foreground text-xs">
                {resource.kind === 'link' ? 'Link' : 'File'}
                {resource.isPublic ? ', open to everyone' : ', enrolled only'}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(resource.id)}
                className="text-destructive ml-auto text-xs underline disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={linkTitle}
            onChange={(event) => setLinkTitle(event.target.value)}
            placeholder="Syllabus"
            className="rounded-md border px-3 py-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(event) => setIsPublic(event.target.checked)}
          />
          Open to everyone, including people who have not enrolled
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
            Web address, if it lives somewhere already
            <input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://example.edu/syllabus.pdf"
              className="rounded-md border px-3 py-2"
            />
          </label>
          <button
            type="button"
            disabled={pending || !linkUrl || !linkTitle}
            onClick={addLink}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-60"
          >
            Add link
          </button>
        </div>

        <label className="text-muted-foreground cursor-pointer text-sm underline">
          {phase === 'sending'
            ? 'Sending...'
            : phase === 'checking'
              ? 'Checking it arrived...'
              : 'Or upload a PDF'}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,text/plain"
            className="hidden"
            disabled={phase !== 'idle'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </section>
  );
}
