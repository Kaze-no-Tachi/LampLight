'use client';

import { useRef, useState } from 'react';
import { checkUpload, uploadWithProgress } from '@/lib/media/uploads';
import { completeUploadAction, requestUploadAction } from './actions';

/**
 * Sending a lesson's recording to the bucket, in the one place that knows how.
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
 *
 * A hook rather than a component, because three screens now need these three
 * steps and each of them draws the surrounding control differently: a dashed
 * dropzone on the add-a-lesson page, a row with a play button on the lesson
 * editor. Copying the sequence per screen is how one of the copies eventually
 * skips step 3.
 */

export type UploadPhase = 'idle' | 'sending' | 'checking';

export function useAudioUpload() {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Returns the message to show, or null when it worked. Callers report it
   * themselves: the lesson editor puts it beside the save indicator and the
   * add-a-lesson page puts it under the dropzone.
   */
  async function upload(lessonId: string, file: File): Promise<string | null> {
    // Checked here so somebody who picked the wrong file is told immediately,
    // rather than after sending 400 MB. The server checks again, because this
    // check is a convenience and not a control.
    const check = checkUpload({ contentType: file.type, byteSize: file.size });
    if (!check.ok) return check.message;

    setPhase('sending');
    setProgress(0);

    const request = new FormData();
    request.set('lessonId', lessonId);
    request.set('filename', file.name);
    request.set('contentType', file.type);
    request.set('byteSize', String(file.size));

    const ticket = await requestUploadAction(request);
    if (ticket.status === 'error') {
      setPhase('idle');
      return ticket.message;
    }

    try {
      await uploadWithProgress(
        ticket.uploadUrl,
        ticket.contentType,
        file,
        setProgress,
      );
    } catch (error) {
      setPhase('idle');
      return error instanceof Error
        ? error.message
        : 'The upload did not finish.';
    }

    setPhase('checking');

    const done = new FormData();
    done.set('resourceId', ticket.resourceId);
    done.set('lessonId', lessonId);
    done.set('isDownloadable', 'true');
    const seconds = await readDurationOf(file);
    if (seconds !== null) done.set('durationSeconds', String(seconds));

    const confirmed = await completeUploadAction(done);
    setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';

    return confirmed.status === 'error' ? confirmed.message : null;
  }

  return { phase, progress, upload, inputRef };
}

/** What the control says while it is working. */
export function uploadLabel(
  phase: UploadPhase,
  progress: number,
  idle: string,
): string {
  if (phase === 'sending') return `Sending ${progress}%`;
  if (phase === 'checking') return 'Checking it arrived';
  return idle;
}

/**
 * How long the recording is, according to the browser.
 *
 * Read locally from the file rather than measured on the server, because the
 * server never sees the bytes. Null whenever the browser cannot decode it,
 * which is a normal outcome for an unusual codec and means the lesson keeps
 * whatever duration it already had.
 */
export function readDurationOf(file: File): Promise<number | null> {
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
