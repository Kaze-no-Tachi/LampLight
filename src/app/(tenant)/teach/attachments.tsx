'use client';

import { useRef, useState, useTransition } from 'react';
import { formatBytes, checkUpload } from '@/lib/media/uploads';
import {
  completeDocumentUploadAction,
  removeAttachmentAction,
  requestDocumentUploadAction,
} from './edit-actions';

export type Attachment = {
  id: string;
  kind: 'audio' | 'video' | 'pdf' | 'link';
  /** The course table calls it a title, the lesson table a filename. */
  label: string;
  byteSize: number | null;
  url: string | null;
  isPublic?: boolean;
};

/**
 * Files and links, on a course or on a lesson.
 *
 * One component for both, matching the one server module behind it. The two
 * places differ only in what the parent is and whether "open to everyone" is
 * a meaningful question, which it is for a syllabus and is not for a lesson
 * handout: a lesson's materials are already gated by the same predicate as its
 * recording.
 *
 * Uploading is offered first and a link second, deliberately. A link is
 * somebody else's uptime and somebody else's decision about whether the file
 * exists next year, and an institute that keeps its reading list on a church
 * website loses it when the church redesigns.
 */
export function Attachments({
  target,
  attachments,
  addLink,
  title,
  description,
  showVisibility = false,
}: {
  target: { kind: 'course' | 'lesson'; id: string };
  attachments: Attachment[];
  /** Adding a link differs per target, so the parent passes its own action. */
  addLink: (data: FormData) => Promise<{ status: string; message?: string }>;
  title: string;
  description: string;
  showVisibility?: boolean;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isPublic, setIsPublic] = useState(showVisibility);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'checking'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  /** Both actions want the parent named the same way the server reads it. */
  function withTarget(values: Record<string, string>): FormData {
    const data = new FormData();
    data.set(target.kind === 'course' ? 'courseId' : 'lessonId', target.id);
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }

  async function upload(file: File) {
    setError(null);

    // Checked here so a wrong file is refused before it is sent, and again on
    // the server, which is the copy that counts.
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
    setProgress(0);

    const ticket = await requestDocumentUploadAction(
      withTarget({
        filename: file.name,
        contentType: file.type,
        byteSize: String(file.size),
        title: name || file.name,
        isPublic: String(isPublic),
      }),
    );

    if (ticket.status === 'error') {
      setError(ticket.message);
      setPhase('idle');
      return;
    }

    try {
      await put(ticket.uploadUrl, ticket.contentType, file, setProgress);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The upload did not finish.',
      );
      setPhase('idle');
      return;
    }

    setPhase('checking');
    const confirmed = await completeDocumentUploadAction(
      withTarget({ resourceId: ticket.resourceId }),
    );

    setPhase('idle');
    setName('');
    if (fileRef.current) fileRef.current.value = '';
    if (confirmed.status === 'error') setError(confirmed.message);
  }

  function link() {
    startTransition(async () => {
      const result = await addLink(
        withTarget({ title: name, url, isPublic: String(isPublic) }),
      );
      setError(result.status === 'error' ? (result.message ?? null) : null);
      if (result.status === 'ok') {
        setName('');
        setUrl('');
      }
    });
  }

  function remove(resourceId: string) {
    startTransition(async () => {
      const result = await removeAttachmentAction(withTarget({ resourceId }));
      setError(result.status === 'error' ? result.message : null);
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      {attachments.length > 0 && (
        <ul className="flex flex-col text-sm">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 border-b py-2"
            >
              <span className="truncate">{attachment.label}</span>
              <span className="text-muted-foreground text-xs">
                {attachment.kind === 'link'
                  ? 'Link'
                  : attachment.byteSize === null
                    ? 'never finished uploading'
                    : formatBytes(attachment.byteSize)}
                {showVisibility
                  ? attachment.isPublic
                    ? ', open to everyone'
                    : ', enrolled only'
                  : ''}
              </span>
              <button
                type="button"
                disabled={pending || phase !== 'idle'}
                onClick={() => remove(attachment.id)}
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
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Reading list"
            className="rounded-md border px-3 py-2"
          />
        </label>

        {showVisibility && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            Open to everyone, including people who have not enrolled
          </label>
        )}

        <label className="bg-primary text-primary-foreground w-fit cursor-pointer rounded-md px-4 py-2 text-sm">
          {phase === 'sending'
            ? `Sending ${progress}%`
            : phase === 'checking'
              ? 'Checking it arrived...'
              : 'Upload a PDF'}
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

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
            Or link to something that lives elsewhere
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.edu/reading-list.pdf"
              className="rounded-md border px-3 py-2"
            />
          </label>
          <button
            type="button"
            disabled={pending || !url || !name}
            onClick={link}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-60"
          >
            Add link
          </button>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </section>
  );
}

/**
 * Sends the file, reporting progress.
 *
 * The same reason as the audio uploader: fetch cannot report upload progress,
 * and a silent wait on a slow connection gets cancelled and retried.
 */
function put(
  url: string,
  contentType: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('content-type', contentType);

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`The bucket answered ${request.status}.`));
    });
    request.addEventListener('error', () =>
      reject(new Error('The connection dropped during the upload.')),
    );

    request.send(file);
  });
}
