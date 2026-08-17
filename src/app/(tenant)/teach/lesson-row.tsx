'use client';

import { useRef, useState, useTransition } from 'react';
import { checkUpload, formatBytes } from '@/lib/media/uploads';
import {
  completeUploadAction,
  removeResourceAction,
  requestUploadAction,
} from './actions';

export type Recording = {
  id: string;
  filename: string | null;
  /** Null means the upload was reserved and never confirmed. */
  byteSize: number | null;
  isDownloadable: boolean;
};

export type Lesson = {
  id: string;
  title: string;
  isFreePreview: boolean;
  recordings: Recording[];
};

/**
 * One lesson on the teaching screen, with whatever is attached to it.
 *
 * THE UPLOAD, IN THREE STEPS
 *
 *   1. Ask the server for a presigned PUT. The server checks who is asking,
 *      builds the key itself, and reserves a row.
 *   2. Send the bytes straight to the bucket. A lecture is tens or hundreds of
 *      megabytes and the application is not in that path on purpose.
 *   3. Tell the server it landed, which makes the server go and look. Until it
 *      has looked, the recording does not exist as far as students are
 *      concerned.
 *
 * Step 3 is the one that is easy to leave out, and leaving it out is how a
 * lesson ends up with a recording that plays silence.
 */
export function LessonRow({
  lesson,
  onError,
}: {
  lesson: Lesson;
  onError: (message: string | null) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'sending' | 'checking'>('idle');
  const [progress, setProgress] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    onError(null);

    // Checked here so somebody who picked the wrong file is told immediately,
    // rather than after sending 400 MB. The server checks again, because this
    // check is a convenience and not a control.
    const check = checkUpload({ contentType: file.type, byteSize: file.size });
    if (!check.ok) {
      onError(check.message);
      return;
    }

    setPhase('sending');
    setProgress(0);

    const request = new FormData();
    request.set('lessonId', lesson.id);
    request.set('filename', file.name);
    request.set('contentType', file.type);
    request.set('byteSize', String(file.size));

    const ticket = await requestUploadAction(request);
    if (ticket.status === 'error') {
      onError(ticket.message);
      setPhase('idle');
      return;
    }

    try {
      await put(ticket.uploadUrl, ticket.contentType, file, setProgress);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'The upload did not finish.',
      );
      setPhase('idle');
      return;
    }

    setPhase('checking');

    const done = new FormData();
    done.set('resourceId', ticket.resourceId);
    done.set('lessonId', lesson.id);
    done.set('isDownloadable', 'true');
    const seconds = await readDurationOf(file);
    if (seconds !== null) done.set('durationSeconds', String(seconds));

    const confirmed = await completeUploadAction(done);
    setPhase('idle');
    if (confirmed.status === 'error') onError(confirmed.message);
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(resourceId: string) {
    startTransition(async () => {
      const result = await removeResourceAction(
        formDataOf({ resourceId, lessonId: lesson.id }),
      );
      onError(result.status === 'error' ? result.message : null);
    });
  }

  return (
    <li className="flex flex-col gap-2 border-b py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{lesson.title}</span>
        {lesson.isFreePreview && (
          <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
            Free preview
          </span>
        )}

        <label className="text-muted-foreground ml-auto cursor-pointer text-xs underline">
          {phase === 'sending'
            ? `Sending ${progress}%`
            : phase === 'checking'
              ? 'Checking it arrived...'
              : lesson.recordings.length > 0
                ? 'Replace audio'
                : 'Upload audio'}
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={phase !== 'idle'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </div>

      {lesson.recordings.length > 0 && (
        <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
          {lesson.recordings.map((recording) => (
            <li key={recording.id} className="flex items-center gap-2">
              <span className="truncate">
                {recording.filename ?? 'Recording'}
              </span>
              <span>
                {recording.byteSize === null
                  ? 'never finished uploading'
                  : formatBytes(recording.byteSize)}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(recording.id)}
                className="text-destructive ml-auto underline disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function formDataOf(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/**
 * Sends the file, reporting progress.
 *
 * XMLHttpRequest rather than fetch, and this is the one place in the codebase
 * that reaches for it: fetch cannot report upload progress, and an instructor
 * sending a 200 MB lecture over a rural connection needs to see that something
 * is happening. A silent five minute wait gets cancelled and retried, which
 * makes it a ten minute wait.
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
    // Has to match what was signed, or the bucket rejects the signature rather
    // than the file, and the error reads like a permissions problem.
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
    request.addEventListener('abort', () =>
      reject(new Error('The upload was cancelled.')),
    );

    request.send(file);
  });
}

/**
 * How long the recording is, according to the browser.
 *
 * Read locally from the file rather than measured on the server, because the
 * server never sees the bytes. Null whenever the browser cannot decode it,
 * which is a normal outcome for an unusual codec and means the lesson keeps
 * whatever duration it already had.
 */
function readDurationOf(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();

    const finish = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    probe.addEventListener('loadedmetadata', () =>
      finish(
        Number.isFinite(probe.duration) ? Math.round(probe.duration) : null,
      ),
    );
    probe.addEventListener('error', () => finish(null));
    // A file the browser starts decoding and never finishes must not hold the
    // upload open forever.
    setTimeout(() => finish(null), 5_000);

    probe.src = url;
  });
}
