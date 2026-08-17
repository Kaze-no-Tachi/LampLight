'use client';

import { usePlayer } from '../../player/player-provider';
import type { Track } from '@/lib/player/track';

/**
 * The button that hands a lesson to the player.
 *
 * All this does is name a track. The element that plays it lives in the layout,
 * which is what lets somebody press play here, walk to another page, and keep
 * listening. The old version of this file owned its own audio element and lost
 * the lecture on every navigation.
 */
export function LessonPlayButton({
  track,
  duration,
}: {
  track: Track;
  duration: string | null;
}) {
  const player = usePlayer();
  const isCurrent = player.track?.resourceId === track.resourceId;
  const isPlaying = isCurrent && player.playing;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => (isPlaying ? player.toggle() : player.play(track))}
        className="bg-primary text-primary-foreground rounded-(--radius) px-4 py-2 text-sm font-medium"
      >
        {isPlaying ? 'Pause' : isCurrent ? 'Resume' : 'Play this lecture'}
      </button>

      {duration && (
        <span className="text-muted-foreground text-sm">{duration}</span>
      )}

      {isCurrent && (
        <span className="text-muted-foreground text-sm">
          Playing in the bar below. It keeps going while you read.
        </span>
      )}
    </div>
  );
}
