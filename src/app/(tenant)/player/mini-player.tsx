'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { formatTime, SKIP_SECONDS } from '@/lib/player/track';
import { usePlayer } from './player-provider';

/**
 * The bar along the bottom, which is the player's interface everywhere except
 * the lesson it belongs to.
 *
 * Fixed rather than sticky, because it has to stay put while the page under it
 * navigates, which is the point of the thing. The body carries bottom padding
 * for it (see the tenant layout) so a footer is never trapped underneath.
 *
 * It hides on the playing lesson's own page. That page has the full transport
 * already, and two sets of play buttons on one screen is a question about
 * which one is real rather than a convenience. Everywhere else it is the only
 * way to reach the lecture, so everywhere else it stays.
 */
export function MiniPlayer() {
  const player = usePlayer();
  const pathname = usePathname();
  const { track } = player;
  if (!track) return null;

  // Compared on pathname alone: track.href is a route we generated, and a
  // query string on the current URL should not bring the bar back.
  if (pathname === track.href) return null;

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
        className="accent-primary block h-1 w-full cursor-pointer appearance-none"
        style={{
          // A visible fill without a second element to keep in sync.
          background: `linear-gradient(to right, var(--primary) ${
            fraction * 100
          }%, var(--muted) ${fraction * 100}%)`,
        }}
      />

      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-4 gap-y-2 px-8 py-3">
        <button
          type="button"
          onClick={player.toggle}
          aria-label={player.playing ? 'Pause' : 'Play'}
          className="bg-primary text-primary-foreground flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full"
        >
          {player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          type="button"
          onClick={() => player.seekBy(-SKIP_SECONDS)}
          className="text-muted-foreground hover:text-foreground cursor-pointer text-(length:--text-label)"
          aria-label={`Back ${SKIP_SECONDS} seconds`}
        >
          &minus;{SKIP_SECONDS}s
        </button>
        <button
          type="button"
          onClick={() => player.seekBy(SKIP_SECONDS)}
          className="text-muted-foreground hover:text-foreground cursor-pointer text-(length:--text-label)"
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
        >
          +{SKIP_SECONDS}s
        </button>

        <div className="flex min-w-40 flex-1 flex-col">
          <span className="truncate text-(length:--text-ui) font-medium">
            {track.title}
          </span>
          <span className="text-muted-foreground truncate text-(length:--text-meta)">
            {track.courseTitle}
          </span>
        </div>

        {player.failed && (
          <span className="text-destructive text-(length:--text-meta)">
            This recording could not be loaded.
          </span>
        )}

        <span className="text-muted-foreground shrink-0 font-mono text-(length:--text-meta)">
          {formatTime(player.position)}
          {player.duration ? ` / ${formatTime(player.duration)}` : ''}
        </span>

        <button
          type="button"
          onClick={player.cycleSpeed}
          className="border-border hover:bg-muted shrink-0 cursor-pointer rounded-(--radius) border px-2 py-1 font-mono text-(length:--text-meta)"
          aria-label="Playback speed"
        >
          {player.speed}&times;
        </button>

        {/* The way back to the notes, which is what somebody listening on
            another page most often wants next. */}
        <Link
          href={track.href}
          className="border-border hover:bg-muted shrink-0 rounded-(--radius) border px-3 py-1.5 text-(length:--text-label) font-medium"
        >
          Open lesson
        </Link>

        {track.isDownloadable && (
          <a
            href={track.url}
            download={track.filename ?? track.title}
            className="text-muted-foreground shrink-0 text-(length:--text-meta) underline underline-offset-4"
          >
            Download
          </a>
        )}

        <button
          type="button"
          onClick={player.close}
          aria-label="Close the player"
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer text-(length:--text-ui)"
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
