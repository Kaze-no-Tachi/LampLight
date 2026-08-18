'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Checkbox, Input } from 'rsuite';
import { timecode } from '@/lib/format';
import { Markdown } from '@/lib/markdown/render';
import { formatBytes } from '@/lib/media/uploads';
import type { Track } from '@/lib/player/track';
import { usePlayer } from '../../../player/player-provider';
import { Attachments, type Attachment } from '../../attachments';
import { addLessonLinkAction, updateLessonAction } from '../../edit-actions';
import {
  FieldLabel,
  FormCard,
  SaveIndicator,
  type SaveState,
} from '../../form-chrome';
import { removeResourceAction } from '../../actions';
import { uploadLabel, useAudioUpload } from '../../use-audio-upload';

export type Recording = {
  id: string;
  filename: string | null;
  /** Null while an upload was reserved and never confirmed. */
  byteSize: number | null;
  uploaded: string;
};

/**
 * Everything about one lesson that an instructor can change (mockup 6).
 *
 * PLAYING IT USES THE STUDENT'S PLAYER, not a second audio element. The
 * provider is mounted above every tenant screen including this one, so
 * pressing play here starts the same transport a student uses and leaves the
 * same bar at the bottom of the page. An author checking they uploaded the
 * right take hears exactly what was uploaded, through exactly the path a
 * student's audio takes.
 *
 * The state indicator is words beside the button rather than a toast, per the
 * design: a toast is gone by the time somebody looks up from the field they
 * were typing in, and "is what I can see stored?" is asked at that moment.
 */
export function LessonEditor({
  lesson,
  recording,
  track,
  materials,
}: {
  lesson: {
    id: string;
    title: string;
    contentMd: string | null;
    isFreePreview: boolean;
    durationSeconds: number | null;
    courseTitle: string;
  };
  recording: Recording | null;
  track: Track | null;
  materials: Attachment[];
}) {
  const router = useRouter();
  const player = usePlayer();
  const audio = useAudioUpload();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>({ kind: 'clean' });
  const [preview, setPreview] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [title, setTitle] = useState(lesson.title);
  const [notes, setNotes] = useState(lesson.contentMd ?? '');
  const [isFreePreview, setIsFreePreview] = useState(lesson.isFreePreview);

  function touch<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setState({ kind: 'dirty' });
    };
  }

  function save() {
    setState({ kind: 'saving' });

    const data = new FormData();
    data.set('lessonId', lesson.id);
    data.set('title', title);
    data.set('contentMd', notes);
    data.set('isFreePreview', String(isFreePreview));

    startTransition(async () => {
      const result = await updateLessonAction(data);
      if (result.status === 'error') {
        setState({ kind: 'error', message: result.message });
        return;
      }
      setState({ kind: 'saved', at: Date.now() });
      router.refresh();
    });
  }

  function attach(file: File) {
    setState({ kind: 'saving' });
    startTransition(async () => {
      const failure = await audio.upload(lesson.id, file);
      if (failure) {
        setState({ kind: 'error', message: failure });
        return;
      }
      setState({ kind: 'saved', at: Date.now() });
      router.refresh();
    });
  }

  function removeRecording() {
    if (!recording) return;
    const data = new FormData();
    data.set('resourceId', recording.id);
    data.set('lessonId', lesson.id);

    startTransition(async () => {
      const result = await removeResourceAction(data);
      if (result.status === 'error') {
        setState({ kind: 'error', message: result.message });
        return;
      }
      router.refresh();
    });
  }

  const isPlaying =
    player.track?.resourceId === track?.resourceId ? player.playing : false;

  const busy = pending || audio.phase !== 'idle';

  // "34:12 · 48 MB · uploaded 3 days ago", with any clause that has nothing
  // to say left out rather than printed empty.
  const meta = recording
    ? [
        timecode(lesson.durationSeconds),
        recording.byteSize === null
          ? 'never finished uploading'
          : formatBytes(recording.byteSize),
        `uploaded ${recording.uploaded}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="flex flex-col gap-[26px]">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="min-w-60 flex-1 text-(length:--text-staff-page) leading-[1.2]">
          {lesson.title}
        </h1>
        <SaveIndicator state={state} />
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="bg-primary text-primary-foreground cursor-pointer rounded-(--radius) px-4 py-2.5 text-(length:--text-ui) font-medium disabled:opacity-60"
        >
          Save lesson
        </button>
      </div>

      <FormCard>
        <label className="flex flex-col gap-[7px]">
          <FieldLabel>Lesson title</FieldLabel>
          <Input
            value={title}
            onChange={touch(setTitle)}
            size="lg"
            aria-label="Lesson title"
          />
        </label>

        <div className="flex flex-col gap-[7px]">
          <div className="flex items-baseline justify-between gap-4">
            <FieldLabel>Notes shown under the player</FieldLabel>
            <button
              type="button"
              onClick={() => setPreview((current) => !current)}
              className="text-muted-foreground cursor-pointer text-(length:--text-meta) font-medium underline underline-offset-[3px]"
            >
              {preview ? 'Back to editing' : 'Preview as a student'}
            </button>
          </div>

          {preview ? (
            <div className="border-border min-h-45 rounded-(--radius) border px-5 py-[18px]">
              <Markdown source={notes} />
            </div>
          ) : (
            <Input
              as="textarea"
              rows={9}
              value={notes}
              onChange={touch(setNotes)}
              placeholder="Outline, scripture references, questions to think about."
              className="font-mono"
              aria-label="Lesson notes"
            />
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <FieldLabel>Recording</FieldLabel>

          {recording ? (
            <div className="border-border bg-muted flex flex-wrap items-center gap-4 rounded-(--radius) border px-4 py-3.5">
              <button
                type="button"
                disabled={!track}
                onClick={() =>
                  track && (isPlaying ? player.toggle() : player.play(track))
                }
                aria-label={isPlaying ? 'Pause' : 'Play the recording'}
                className="bg-primary text-primary-foreground flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full disabled:opacity-40"
              >
                {isPlaying ? (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
                  </svg>
                ) : (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M8 5v14l11-7z" fill="currentColor" />
                  </svg>
                )}
              </button>

              <div className="flex min-w-40 flex-1 flex-col gap-[3px]">
                <span className="truncate text-(length:--text-ui) font-medium">
                  {recording.filename ?? 'Recording'}
                </span>
                <span className="text-muted-foreground text-(length:--text-meta)">
                  {audio.phase === 'idle'
                    ? meta
                    : uploadLabel(audio.phase, audio.progress, meta)}
                </span>
              </div>

              <label className="border-border bg-card hover:border-primary cursor-pointer rounded-(--radius) border px-3 py-[7px] text-(length:--text-label) font-medium transition-colors">
                Replace
                <input
                  ref={audio.inputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) attach(file);
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={removeRecording}
                className="text-muted-foreground cursor-pointer text-(length:--text-label) font-medium underline-offset-4 hover:underline disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ) : (
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) attach(dropped);
              }}
              className={`bg-background flex cursor-pointer items-center gap-3.5 rounded-(--radius) border border-dashed px-4 py-[18px] transition-colors ${
                dragging ? 'border-primary' : 'border-border'
              }`}
            >
              <span className="bg-secondary text-secondary-foreground flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full">
                &uarr;
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-(length:--text-ui) font-medium">
                  {audio.phase === 'idle'
                    ? 'No recording yet. Drop the audio here, or choose a file'
                    : uploadLabel(audio.phase, audio.progress, '')}
                </span>
                <span className="text-muted-foreground text-(length:--text-meta)">
                  m4a, mp3 or wav.
                </span>
              </span>
              <input
                ref={audio.inputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) attach(file);
                }}
              />
            </label>
          )}

          <span className="text-muted-foreground text-(length:--text-meta)">
            Duration is read from the file after upload, not typed.
          </span>
        </div>

        {/* Under the divider because it is the one control here that changes
            who may hear the lesson rather than what the lesson is. */}
        <div className="border-border flex flex-col border-t pt-[18px]">
          <Checkbox
            checked={isFreePreview}
            onChange={(_value, checked: boolean) =>
              touch(setIsFreePreview)(checked)
            }
          >
            <span className="text-(length:--text-ui) font-semibold">
              Open to everyone
            </span>
          </Checkbox>
          <span className="text-muted-foreground max-w-[60ch] pl-9 text-(length:--text-label) leading-[1.55]">
            Anyone who finds this lesson can hear it without an account or an
            enrolment. Use it for the first lesson of a course, so people can
            listen before they decide.
          </span>
        </div>
      </FormCard>

      <Attachments
        target={{ kind: 'lesson', id: lesson.id }}
        addLink={addLessonLinkAction}
        title="Materials"
        description="Handouts for this lesson, shown to whoever may hear it and to nobody else."
        attachments={materials}
      />
    </div>
  );
}
