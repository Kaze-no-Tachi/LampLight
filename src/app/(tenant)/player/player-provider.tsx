'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  isComplete,
  isPlayerShortcut,
  nextSpeed,
  shouldResumeFrom,
  SKIP_SECONDS,
  type Track,
} from '@/lib/player/track';
import { MiniPlayer } from './mini-player';

/**
 * The player, mounted once in the tenant layout (PRD requirement P0-8).
 *
 * WHY IT LIVES IN THE LAYOUT
 *
 * "Survives navigation" is the requirement, and in the App Router that is not a
 * feature to build, it is a place to mount. A client component in the layout
 * keeps its state and its DOM across route changes, so the media element is
 * never unmounted and the audio never stops. Putting the element on the lesson
 * page instead would mean re-creating it on every navigation, which is exactly
 * the behaviour students complain about: press play, tap another lesson to read
 * its notes, and the lecture stops.
 *
 * WHAT IT SYNCS, AND HOW OFTEN
 *
 * Position goes to the server every fifteen seconds while playing, on pause, and
 * when the page is hidden or unloaded. The last of those uses sendBeacon,
 * because a normal fetch during unload is cancelled and the whole point is the
 * position of somebody who closed the tab mid-lecture.
 */

type PlayerState = {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number | null;
  speed: number;
  failed: boolean;
};

type PlayerControls = PlayerState & {
  play(track: Track): void;
  toggle(): void;
  seekBy(seconds: number): void;
  seekTo(seconds: number): void;
  cycleSpeed(): void;
  close(): void;
};

const PlayerContext = createContext<PlayerControls | null>(null);

/** Throws rather than returning null, so a missing provider fails loudly. */
export function usePlayer(): PlayerControls {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer needs a PlayerProvider above it');
  }
  return context;
}

const SYNC_INTERVAL_MS = 15_000;

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);

  // Read by callbacks that must not re-subscribe every second. State drives the
  // rendering, refs drive the syncing.
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const trackRef = useRef<Track | null>(null);

  const sync = useCallback((useBeacon: boolean) => {
    const current = trackRef.current;
    if (!current) return;

    const body = JSON.stringify({
      positionSeconds: Math.floor(positionRef.current),
      completed: isComplete(positionRef.current, durationRef.current),
    });
    const url = `/api/tenant/lessons/${current.lessonId}/progress`;

    // During unload a fetch is cancelled, and the position of somebody who
    // closed the tab is precisely the one worth keeping.
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }

    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // A failed position write is not worth telling anybody about. The next
      // one carries the same information.
    });
  }, []);

  /**
   * Re-issues the media URL and carries on from where playback stopped.
   *
   * Signed URLs are deliberately short lived, so a long lecture will outlive
   * one. The fix is asking for another, not signing for longer: a URL that
   * lasts an afternoon is a URL that can be shared for an afternoon.
   */
  const refreshUrl = useCallback(async () => {
    const current = trackRef.current;
    const audio = audioRef.current;
    if (!current || !audio) return;

    try {
      const response = await fetch(
        `/api/tenant/lessons/${current.lessonId}/media`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        setFailed(true);
        return;
      }

      const body = (await response.json()) as {
        media?: { resourceId: string; url: string }[];
      };
      const match = body.media?.find(
        (item) => item.resourceId === current.resourceId,
      );
      if (!match) {
        setFailed(true);
        return;
      }

      const resumeAt = positionRef.current;
      trackRef.current = { ...current, url: match.url };
      setTrack(trackRef.current);
      audio.src = match.url;
      audio.currentTime = resumeAt;
      await audio.play();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const play = useCallback(
    (next: Track) => {
      const audio = audioRef.current;
      if (!audio) return;

      // Same lesson, already loaded: this is a resume, not a reload. Reloading
      // would restart a lecture somebody is halfway through.
      if (trackRef.current?.resourceId === next.resourceId) {
        void audio.play();
        return;
      }

      // Whatever was playing gets its position written before it is replaced.
      if (trackRef.current) sync(false);

      trackRef.current = next;
      setTrack(next);
      setFailed(false);
      setPosition(0);
      setDuration(null);
      positionRef.current = 0;
      durationRef.current = null;

      audio.src = next.url;
      audio.playbackRate = speed;

      // Resume where they were. Asked for after the source is set, so a slow
      // answer cannot arrive before the element is ready to seek.
      void fetch(`/api/tenant/lessons/${next.lessonId}/progress`, {
        cache: 'no-store',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { positionSeconds?: number } | null) => {
          if (!data || trackRef.current?.lessonId !== next.lessonId) return;
          const resumeAt = shouldResumeFrom(
            data.positionSeconds ?? 0,
            durationRef.current,
          );
          if (resumeAt > 0) audio.currentTime = resumeAt;
        })
        .catch(() => {
          // No stored position, or the request failed. Start at the beginning,
          // which is what somebody who has never listened would get anyway.
        });

      void audio.play().catch(() => setFailed(true));
    },
    [speed, sync],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !trackRef.current) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const bounded = Math.max(0, Math.min(audio.duration || seconds, seconds));
    audio.currentTime = bounded;
    setPosition(bounded);
    positionRef.current = bounded;
  }, []);

  const seekBy = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      seekTo(audio.currentTime + seconds);
    },
    [seekTo],
  );

  const cycleSpeed = useCallback(() => {
    setSpeed((current) => {
      const next = nextSpeed(current);
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  }, []);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      sync(false);
      audio.removeAttribute('src');
      audio.load();
    }
    trackRef.current = null;
    setTrack(null);
    setPlaying(false);
  }, [sync]);

  // Periodic sync while playing. Cleared when paused, so a paused tab is not
  // writing the same number every fifteen seconds forever.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => sync(false), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, sync]);

  // The tab going away, which is the most common way a lecture ends.
  useEffect(() => {
    function onHidden() {
      if (document.visibilityState === 'hidden') sync(true);
    }
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', () => sync(true));
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [sync]);

  // Keyboard shortcuts, ignored while somebody is typing (see isPlayerShortcut).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!trackRef.current) return;
      if (!isPlayerShortcut(event)) return;

      event.preventDefault();
      if (event.key === ' ' || event.key === 'k') toggle();
      if (event.key === 'ArrowLeft' || event.key === 'j') {
        seekBy(-SKIP_SECONDS);
      }
      if (event.key === 'ArrowRight' || event.key === 'l') {
        seekBy(SKIP_SECONDS);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seekBy, toggle]);

  return (
    <PlayerContext.Provider
      value={{
        track,
        playing,
        position,
        duration,
        speed,
        failed,
        play,
        toggle,
        seekBy,
        seekTo,
        cycleSpeed,
        close,
      }}
    >
      {children}

      {/*
        One element, never unmounted, no controls of its own: the mini-player
        below is the interface. Audio for now; a video lesson would need a
        surface to draw on, which is the only part of this that changes.
      */}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          sync(false);
        }}
        onTimeUpdate={(event) => {
          const value = event.currentTarget.currentTime;
          positionRef.current = value;
          setPosition(value);
        }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          durationRef.current = Number.isFinite(value) ? value : null;
          setDuration(durationRef.current);
          event.currentTarget.playbackRate = speed;
        }}
        onEnded={() => {
          setPlaying(false);
          positionRef.current = durationRef.current ?? positionRef.current;
          sync(false);
        }}
        /**
         * An error here is usually an expired URL on a long lecture, which is
         * recoverable and should not interrupt anybody. It can also be a
         * resource row pointing at an object that was never uploaded, which is
         * not, and that is what the message in the mini-player is for.
         */
        onError={() => {
          if (trackRef.current) void refreshUrl();
        }}
      >
        <track kind="captions" />
      </audio>

      {track && <MiniPlayer />}
    </PlayerContext.Provider>
  );
}
