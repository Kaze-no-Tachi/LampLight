import { describe, expect, it } from 'vitest';
import {
  clampPosition,
  formatTime,
  isComplete,
  isPlayerShortcut,
  MAX_POSITION_SECONDS,
  nextSpeed,
  shouldResumeFrom,
  SPEEDS,
} from '@/lib/player/track';

/**
 * The player's decisions, without a browser.
 *
 * These are small on purpose: everything that could be pulled out of the React
 * component was, so the parts that are easy to get subtly wrong (a position
 * that reads NaN:NaN, a resume that lands on silence, a spacebar that scrubs a
 * lecture while somebody types) are checked here rather than by clicking.
 */

describe('showing a position', () => {
  it('reads as a time, not as a number of seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('grows an hours field for a long lecture', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3725)).toBe('1:02:05');
  });

  it('survives what a media element reports before it has loaded', () => {
    // duration is NaN until metadata arrives, and currentTime can be -0.
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('resuming', () => {
  it('picks up where somebody actually stopped', () => {
    expect(shouldResumeFrom(600, 1800)).toBe(600);
  });

  it('ignores a position a few seconds in', () => {
    // Somebody pressed play and left. Resuming at eight seconds is worse than
    // starting over, because it looks like the recording is broken.
    expect(shouldResumeFrom(8, 1800)).toBe(0);
  });

  it('starts again when they got to the end', () => {
    // Otherwise pressing play on a finished lecture plays silence.
    expect(shouldResumeFrom(1795, 1800)).toBe(0);
  });

  it('resumes without knowing the duration', () => {
    // Metadata may not have arrived yet. A stored position is still better
    // than nothing.
    expect(shouldResumeFrom(600, null)).toBe(600);
  });
});

describe('marking a lecture finished', () => {
  it('does not need the last few seconds', () => {
    // People stop when the speaker stops, not when the file does.
    expect(isComplete(1710, 1800)).toBe(true);
    expect(isComplete(1500, 1800)).toBe(false);
  });

  it('says no when the duration is unknown', () => {
    expect(isComplete(1710, null)).toBe(false);
  });
});

describe('speed', () => {
  it('cycles and wraps', () => {
    expect(nextSpeed(1)).toBe(1.25);
    expect(nextSpeed(SPEEDS[SPEEDS.length - 1] ?? 2)).toBe(SPEEDS[0]);
  });

  it('recovers from a speed that is not on the list', () => {
    expect(SPEEDS).toContain(nextSpeed(1.1));
  });
});

describe('what the server will accept as a position', () => {
  it('takes a plain number of seconds', () => {
    expect(clampPosition(42)).toBe(42);
    expect(clampPosition(42.9)).toBe(42);
  });

  it('refuses anything that is not a finite number', () => {
    for (const value of ['600', null, undefined, {}, Number.NaN, Infinity]) {
      expect(clampPosition(value)).toBeNull();
    }
  });

  it('bounds it, because the column is an integer and the client is not', () => {
    expect(clampPosition(-30)).toBe(0);
    expect(clampPosition(1e12)).toBe(MAX_POSITION_SECONDS);
  });
});

describe('keyboard shortcuts', () => {
  function press(key: string, target?: unknown, modifiers = {}) {
    return isPlayerShortcut({ key, target, ...modifiers });
  }

  it('claims the keys a player needs', () => {
    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'k', 'j', 'l']) {
      expect(press(key, { tagName: 'BODY' })).toBe(true);
    }
  });

  it('leaves anything typed into a field alone', () => {
    // THE BUG THIS PREVENTS: space scrubbing the lecture while a student types
    // their home congregation into the signup form.
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(press(' ', { tagName })).toBe(false);
    }
    expect(press(' ', { tagName: 'DIV', isContentEditable: true })).toBe(false);
  });

  it('leaves browser combinations alone', () => {
    expect(press('l', { tagName: 'BODY' }, { metaKey: true })).toBe(false);
    expect(press(' ', { tagName: 'BODY' }, { ctrlKey: true })).toBe(false);
  });

  it('ignores keys that are not the player business', () => {
    expect(press('Enter', { tagName: 'BODY' })).toBe(false);
    expect(press('Tab', { tagName: 'BODY' })).toBe(false);
  });
});
