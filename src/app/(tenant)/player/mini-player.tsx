'use client';

import Link from 'next/link';
import { formatTime, SKIP_SECONDS } from '@/lib/player/track';
import { usePlayer } from './player-provider';

/**
 * The bar along the bottom, which is the whole interface to the player.
 *
 * Fixed rather than sticky, because it has to stay put while the page under it
 * navigates, which is the point of the thing. The body carries bottom padding
 * for it (see the tenant layout) so a footer is never trapped underneath.
 */
export function MiniPlayer() {
  const player = usePlayer();
  const { track } = player;
  if (!track) return null;

  const fraction =
    player.duration && player.duration > 0
      ? Math.min(1, player.position / player.duration)
      : 0;

  return (
    <div className="border-border bg-card fixed inset-x-0 bottom-0 z-50 border-t">
      {/* Progress, and a way to scrub. A range input rather than a styled div
          because it is keyboard operable and screen readers already know it. */}
      <label className="sr-only" htmlFor="lamplight-seek">
        Position in {track.title}
      </label>
      <input
        id="lamplight-seek"
        type="range"
        min={0}
        max={player.duration ?? 0}
        step={1}
        value={player.position}
        onChange={(event) => player.seekTo(Number(event.target.value))}
        disabled={!player.duration}
        className="accent-primary h-1 w-full cursor-pointer"
        style={{
          // A visible fill without a second element to keep in sync.
          background: `linear-gradient(to right, var(--primary) ${
            fraction * 100
          }%, var(--muted) ${fraction * 100}%)`,
        }}
      />

      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
        <button
          type="button"
          onClick={player.toggle}
          aria-label={player.playing ? 'Pause' : 'Play'}
          className="bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-full"
        >
          {player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          type="button"
          onClick={() => player.seekBy(-SKIP_SECONDS)}
          className="text-muted-foreground text-sm"
          aria-label={`Back ${SKIP_SECONDS} seconds`}
        >
          -{SKIP_SECONDS}s
        </button>
        <button
          type="button"
          onClick={() => player.seekBy(SKIP_SECONDS)}
          className="text-muted-foreground text-sm"
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
        >
          +{SKIP_SECONDS}s
        </button>

        <div className="flex min-w-40 flex-1 flex-col">
          <Link
            href={track.href}
            className="truncate text-sm font-medium underline-offset-4 hover:underline"
          >
            {track.title}
          </Link>
          <span className="text-muted-foreground truncate text-xs">
            {track.courseTitle}
          </span>
        </div>

        {player.failed && (
          <span className="text-destructive text-xs">
            This recording could not be loaded.
          </span>
        )}

        <span className="text-muted-foreground font-mono text-xs">
          {formatTime(player.position)}
          {player.duration ? ` / ${formatTime(player.duration)}` : ''}
        </span>

        <button
          type="button"
          onClick={player.cycleSpeed}
          className="rounded-md border px-2 py-1 text-xs"
          aria-label="Playback speed"
        >
          {player.speed}x
        </button>

        {track.isDownloadable && (
          <a
            href={track.url}
            download={track.filename ?? track.title}
            className="text-muted-foreground text-xs underline"
          >
            Download
          </a>
        )}

        <button
          type="button"
          onClick={player.close}
          aria-label="Close the player"
          className="text-muted-foreground text-sm"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  );
}
