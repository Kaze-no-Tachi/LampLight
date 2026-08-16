'use client';

import { useRef, useState } from 'react';

/**
 * A minimal audio player, pulled forward from the PRD's week 15.
 *
 * Not the persistent mini-player P0-8 asks for. That one survives navigation,
 * remembers position server-side, and carries keyboard shortcuts, and it needs
 * a layout-level component and a progress endpoint that do not exist yet.
 *
 * This exists because a signed URL that returns 200 to a fetch is not the same
 * claim as audio that plays in a browser. Content type, range requests, and
 * CORS all sit between the two, and none of them are exercised by a test that
 * checks a status code. So the smallest thing that actually plays.
 *
 * The src is a short-lived signed URL. It will expire mid-session on a long
 * lecture, which is the known gap the real player has to handle by asking for
 * a fresh one rather than by lengthening the expiry.
 */
export function LessonPlayer({
  title,
  sources,
}: {
  title: string;
  sources: {
    id: string;
    url: string;
    filename: string | null;
    isDownloadable: boolean;
  }[];
}) {
  const [rate, setRate] = useState(1);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  function changeRate(next: number) {
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  const first = sources[0];
  if (!first) return null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={first.url}
        className="w-full"
        /**
         * A resource row can point at an object that is not there: an upload
         * that was authorised and then abandoned leaves the row behind, by
         * design, so that a file which does arrive is never orphaned. Without
         * this the player is simply inert, which reads as the site being
         * broken rather than as one recording being missing.
         */
        onError={() => setFailed(true)}
      >
        <track kind="captions" />
      </audio>

      {failed && (
        <p className="text-destructive text-sm">
          This recording could not be loaded. It may still be uploading, or it
          may need to be uploaded again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">Speed</span>
        {[0.75, 1, 1.25, 1.5, 2].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => changeRate(option)}
            className={
              rate === option
                ? 'bg-primary text-primary-foreground rounded-md px-2 py-1 text-sm'
                : 'rounded-md border px-2 py-1 text-sm'
            }
          >
            {option}x
          </button>
        ))}

        {first.isDownloadable && (
          <a
            href={first.url}
            download={first.filename ?? title}
            className="text-muted-foreground ml-auto text-sm underline"
          >
            Download
          </a>
        )}
      </div>
    </div>
  );
}
