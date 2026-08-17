'use client';

import { useState, useTransition } from 'react';
import { Markdown } from '@/lib/markdown/render';
import { formatTime } from '@/lib/player/track';
import { Attachments } from '../../attachments';
import { addLessonLinkAction, updateLessonAction } from '../../edit-actions';
import { LessonRow } from '../../lesson-row';

type Resource = {
  id: string;
  kind: 'audio' | 'video' | 'pdf' | 'link';
  filename: string | null;
  byteSize: number | null;
};

/**
 * Everything about one lesson that an instructor can change.
 *
 * The audio control is the same component the teaching list uses, rather than
 * a second one that does the same thing: an upload path that exists twice is
 * an upload path that gets fixed once.
 */
export function LessonEditor({
  lesson,
  resources,
}: {
  lesson: {
    id: string;
    title: string;
    contentMd: string | null;
    isFreePreview: boolean;
    durationSeconds: number | null;
  };
  resources: Resource[];
}) {
  const [title, setTitle] = useState(lesson.title);
  const [notes, setNotes] = useState(lesson.contentMd ?? '');
  const [isFreePreview, setIsFreePreview] = useState(lesson.isFreePreview);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const audio = resources.filter((resource) => resource.kind === 'audio');
  const attachments = resources.filter((resource) => resource.kind !== 'audio');

  function save() {
    const data = new FormData();
    data.set('lessonId', lesson.id);
    data.set('title', title);
    data.set('contentMd', notes);
    data.set('isFreePreview', String(isFreePreview));

    startTransition(async () => {
      const result = await updateLessonAction(data);
      setError(result.status === 'error' ? result.message : null);
      setMessage(result.status === 'ok' ? 'Saved.' : null);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Lesson title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="rounded-md border px-3 py-2"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center justify-between">
            <label htmlFor="lesson-notes">Notes for this lesson</label>
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
              <Markdown source={notes} />
            </div>
          ) : (
            <textarea
              id="lesson-notes"
              rows={12}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={
                'Outline, scripture references, questions to think about.'
              }
              className="rounded-md border px-3 py-2 font-mono text-xs"
            />
          )}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={isFreePreview}
            onChange={(event) => setIsFreePreview(event.target.checked)}
          />
          <span>
            <strong>Open to everyone.</strong> Anyone who finds this lesson can
            hear it without an account or an enrollment. Use it for the first
            lesson of a course, so people can listen before they decide.
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm disabled:opacity-60"
          >
            {pending ? 'Saving...' : 'Save lesson'}
          </button>
          {message && <span className="text-sm">{message}</span>}
          {error && <span className="text-destructive text-sm">{error}</span>}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Recording</h2>
        {lesson.durationSeconds && (
          <p className="text-muted-foreground text-sm">
            {formatTime(lesson.durationSeconds)} long, measured from the file.
          </p>
        )}
        <ul className="flex flex-col">
          <LessonRow
            lesson={{
              id: lesson.id,
              title: audio.length > 0 ? 'Audio' : 'No audio yet',
              isFreePreview: false,
              recordings: audio.map((resource) => ({
                id: resource.id,
                filename: resource.filename,
                byteSize: resource.byteSize,
                isDownloadable: true,
              })),
            }}
            onError={setError}
          />
        </ul>
      </section>

      <Attachments
        target={{ kind: 'lesson', id: lesson.id }}
        addLink={addLessonLinkAction}
        title="Materials"
        description="Handouts for this lesson, shown to whoever may hear it and to nobody else."
        attachments={attachments.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          label: resource.filename ?? 'Material',
          byteSize: resource.byteSize,
          url: null,
        }))}
      />
    </div>
  );
}
