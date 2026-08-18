'use client';

import { usePlayer } from '../../player/player-provider';
import { formatTime, type Track } from '@/lib/player/track';

/**
 * The transport for one lesson: play, scrub, skip back, change speed.
 *
 * It owns no audio. The element that plays lives in the layout, which is what
 * lets somebody press play here, walk to another page, and keep listening; an
 * earlier version owned its own audio element and lost the lecture on every
 * navigation. Everything below reads and drives the shared player instead.
 *
 * The three controls are the ones a lecture actually needs. Skip back fifteen
 * seconds is for the sentence you missed, and speed is for the lecturer who
 * talks slowly. There is no skip forward: nothing here is an advertisement,
 * and a student who wants to be further on can drag the track.
 */
export function LessonPlayButton({
  track,
  duration,
}: {
  track: Track;
  /** The stored duration, shown before the file has loaded its own. */
  duration: string | null;
}) {
  const player = usePlayer();
  const isCurrent = player.track?.resourceId === track.resourceId;
  const isPlaying = isCurrent && player.playing;

  // Before this lesson is the loaded track there is no live position, so the
  // bar sits at zero and the total falls back to what the database recorded.
  const position = isCurrent ? player.position : 0;
  const total = isCurrent && player.duration ? player.duration : null;
  const percent = total && total > 0 ? (position / total) * 100 : 0;

  /**
   * Click to seek. The track is a button rather than an input[type=range]
   * because the design draws a plain 8px bar, and a range input styled into
   * one loses its keyboard behaviour on the way. Keyboard users get the skip
   * control beside it, which is the same operation in fixed steps.
   */
  function seekFromClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (!isCurrent || !total) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    player.seekTo(Math.max(0, Math.min(1, ratio)) * total);
  }

  return (
    <div className="border-border bg-card flex flex-col gap-4 rounded-(--radius) border px-7 py-6">
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={() => (isPlaying ? player.toggle() : player.play(track))}
          aria-label={isPlaying ? 'Pause' : isCurrent ? 'Resume' : 'Play'}
          className="bg-primary text-primary-foreground flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full"
        >
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <button
            type="button"
            onClick={seekFromClick}
            aria-label="Seek"
            disabled={!isCurrent || !total}
            className="bg-muted h-2 w-full cursor-pointer overflow-hidden rounded-full disabled:cursor-default"
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${percent}%` }}
            />
          </button>

          <div className="text-muted-foreground flex items-center justify-between font-mono text-(length:--text-meta)">
            <span>{formatTime(position)}</span>
            <span>{total ? formatTime(total) : (duration ?? '')}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => player.seekBy(-15)}
            disabled={!isCurrent}
            className="border-border hover:bg-muted cursor-pointer rounded-(--radius) border px-3 py-1.5 text-(length:--text-label) font-medium disabled:opacity-40"
          >
            &minus;15s
          </button>
          <button
            type="button"
            onClick={() => player.cycleSpeed()}
            aria-label="Playback speed"
            className="border-border hover:bg-muted cursor-pointer rounded-(--radius) border px-3 py-1.5 font-mono text-(length:--text-label) font-medium"
          >
            {player.speed}&times;
          </button>
        </div>
      </div>

      {player.failed ? (
        <p className="text-destructive text-(length:--text-label)">
          That recording would not load. Reload the page to try again.
        </p>
      ) : (
        <p className="text-muted-foreground text-(length:--text-label)">
          Your place is saved as you listen. Close the tab and come back to this
          second.
        </p>
      )}
    </div>
  );
}
