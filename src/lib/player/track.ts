/**
 * What the player plays, and the small pure decisions it makes.
 *
 * Separate from the React code so the parts worth asserting can be tested
 * without a browser: what a position looks like as text, which speed comes
 * next, whether a stored position is worth resuming from, and when a key press
 * belongs to the player rather than to whatever the person is typing into.
 *
 * ON `kind`, AND WHY IT IS NOT `'audio'`
 *
 * The PRD puts video out of scope for v1 and says in the same breath that the
 * player abstraction must not assume audio. So everything above the media
 * element is kind-agnostic: the track, the queue, the position sync, the
 * shortcuts, the mini-player. Adding video later means choosing a different
 * element and giving it somewhere to draw, and changing nothing here.
 */

export type PlayableKind = 'audio' | 'video';

export type Track = {
  readonly lessonId: string;
  readonly resourceId: string;
  readonly title: string;
  /** Shown under the title, so somebody knows which course they are in. */
  readonly courseTitle: string;
  /** Where the mini-player links back to. */
  readonly href: string;
  readonly kind: PlayableKind;
  /** Short-lived and signed. Expected to expire, and re-fetched when it does. */
  readonly url: string;
  readonly filename: string | null;
  readonly isDownloadable: boolean;
};

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Cycles through the speeds, wrapping, which is what a single button needs. */
export function nextSpeed(current: number): number {
  const index = SPEEDS.findIndex((speed) => speed === current);
  return SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
}

/** How far a skip goes. Ten seconds is the shape of a missed sentence. */
export const SKIP_SECONDS = 10;

/**
 * mm:ss, or h:mm:ss past an hour, which lectures routinely are.
 *
 * Negative and non-finite inputs become 0:00 rather than NaN:NaN, because a
 * media element reports both before it has loaded metadata.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(secs).padStart(2, '0')}`;
}

/**
 * Whether a stored position is worth jumping to.
 *
 * Two edges, both from listening to things rather than from theory. A position
 * a few seconds in is somebody who pressed play and stopped, and resuming there
 * is worse than starting over. A position at the very end is somebody who
 * finished, and resuming there means pressing play and immediately hearing
 * silence, so it starts again from the top.
 */
export function shouldResumeFrom(
  storedSeconds: number,
  durationSeconds: number | null,
): number {
  if (!Number.isFinite(storedSeconds) || storedSeconds < 15) return 0;

  if (durationSeconds && Number.isFinite(durationSeconds)) {
    if (storedSeconds >= durationSeconds - 15) return 0;
  }

  return Math.floor(storedSeconds);
}

/** Past this fraction, a lecture counts as listened to. */
const COMPLETION_RATIO = 0.95;

export function isComplete(
  positionSeconds: number,
  durationSeconds: number | null,
): boolean {
  if (!durationSeconds || !Number.isFinite(durationSeconds)) return false;
  return positionSeconds >= durationSeconds * COMPLETION_RATIO;
}

/**
 * Whether a key press belongs to the player.
 *
 * Space scrubbing a lecture while somebody types their home congregation into
 * a signup form is the classic version of this bug, so anything typed into a
 * field, a select, or an editable region is left alone. Modifier combinations
 * are left alone too, because those belong to the browser.
 */
export function isPlayerShortcut(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;

  const target = event.target as {
    tagName?: string;
    isContentEditable?: boolean;
  } | null;

  if (target?.isContentEditable) return false;
  const tag = target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;

  return [' ', 'ArrowLeft', 'ArrowRight', 'k', 'j', 'l'].includes(event.key);
}

/** Longer than any lecture anybody will upload, and a bound on nonsense. */
export const MAX_POSITION_SECONDS = 24 * 60 * 60;

/**
 * Reads a position out of whatever a browser sent, or null.
 *
 * Here rather than in the route so it can be tested without an HTTP request.
 * The value arrives from a client, so it can be negative, fractional, infinite,
 * a string, or a number of seconds longer than any recording, and the column it
 * lands in is a plain integer.
 */
export function clampPosition(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(MAX_POSITION_SECONDS, Math.floor(value)));
}
