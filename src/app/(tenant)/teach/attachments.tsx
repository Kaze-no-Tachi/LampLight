'use client';

import { useRef, useState, useTransition } from 'react';
import { Checkbox, Input } from 'rsuite';
import {
  checkUpload,
  formatBytes,
  uploadWithProgress,
} from '@/lib/media/uploads';
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
  const [linking, setLinking] = useState(false);
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
      await uploadWithProgress(
        ticket.uploadUrl,
        ticket.contentType,
        file,
        setProgress,
      );
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

  const busy = pending || phase !== 'idle';

  return (
    <section className="border-border bg-card flex flex-col gap-3.5 rounded-(--radius) border px-6 py-[22px]">
      <div className="flex flex-col gap-1">
        <h2 className="text-(length:--text-row-title) leading-tight">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-[70ch] text-(length:--text-label) leading-[1.55]">
          {description}
        </p>
      </div>

      {attachments.length === 0 ? (
        <p className="text-muted-foreground text-(length:--text-label)">
          Nothing yet. Upload a file or add a link.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="border-border flex flex-wrap items-center gap-3.5 rounded-(--radius) border px-3.5 py-[11px]"
            >
              {/* The kind first and in caps, as the mockup has it: a list of
                  handouts is scanned for "which of these is the PDF". */}
              <span className="text-muted-foreground min-w-[34px] text-[0.6875rem] font-medium tracking-[0.1em] uppercase">
                {attachment.kind}
              </span>
              <span className="min-w-40 flex-1 truncate text-(length:--text-ui)">
                {attachment.label}
              </span>
              <span className="text-muted-foreground text-(length:--text-meta) whitespace-nowrap">
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
                disabled={busy}
                onClick={() => remove(attachment.id)}
                className="text-muted-foreground cursor-pointer text-(length:--text-label) font-medium underline-offset-4 hover:underline disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3.5">
        <label className="text-primary cursor-pointer text-(length:--text-label) font-medium underline-offset-4 hover:underline">
          {phase === 'sending'
            ? `Sending ${progress}%`
            : phase === 'checking'
              ? 'Checking it arrived'
              : 'Upload a file'}
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

        {/* Linking is disclosed rather than shown, because uploading is the
            answer that keeps working: a link is somebody else's uptime and
            somebody else's decision about whether the file exists next year. */}
        <button
          type="button"
          onClick={() => setLinking((current) => !current)}
          className="text-muted-foreground cursor-pointer text-(length:--text-label) font-medium underline-offset-4 hover:underline"
        >
          {linking ? 'Never mind the link' : 'Add a link'}
        </button>

        <span className="text-muted-foreground text-(length:--text-meta)">
          PDF or plain text, up to 25 MB.
        </span>
      </div>

      {linking && (
        <div className="border-border flex flex-col gap-2.5 rounded-(--radius) border border-dashed px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="min-w-40 flex-1">
              <Input
                value={name}
                onChange={(next: string) => setName(next)}
                placeholder="Reading list"
                aria-label="What the link is called"
              />
            </div>
            <div className="min-w-60 flex-[2]">
              <Input
                value={url}
                onChange={(next: string) => setUrl(next)}
                placeholder="https://example.edu/reading-list.pdf"
                aria-label="Web address"
              />
            </div>
            <button
              type="button"
              disabled={pending || !url || !name}
              onClick={link}
              className="border-border hover:border-primary cursor-pointer rounded-(--radius) border px-[13px] py-[9px] text-(length:--text-label) font-medium disabled:opacity-60"
            >
              Add link
            </button>
          </div>

          {showVisibility && (
            <Checkbox
              checked={isPublic}
              onChange={(_value, checked: boolean) => setIsPublic(checked)}
            >
              <span className="text-(length:--text-label)">
                Open to everyone, including people who have not enrolled
              </span>
            </Checkbox>
          )}
        </div>
      )}

      {/* The name field is only asked for with a link. An upload already has
          one, and asking for it twice is how a handout ends up called
          "Untitled" because somebody skipped the box above the button. */}
      {showVisibility && !linking && (
        <Checkbox
          checked={isPublic}
          onChange={(_value, checked: boolean) => setIsPublic(checked)}
        >
          <span className="text-(length:--text-label)">
            Uploads are open to everyone, including people who have not enrolled
          </span>
        </Checkbox>
      )}

      {error && (
        <p className="text-destructive text-(length:--text-label)">{error}</p>
      )}
    </section>
  );
}
