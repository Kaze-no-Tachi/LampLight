import { describe, expect, it } from 'vitest';
import { sinceWhen } from '@/lib/format';

/**
 * How long ago a recording arrived, which the lesson editor prints next to the
 * file so somebody who has just replaced one can see that it changed.
 *
 * Worth asserting because the boundaries are where this reads wrong rather
 * than merely imprecise: "0 minutes ago" and "24 hours ago" are both things a
 * naive version says, and both make a reader look twice.
 */

const NOW = new Date('2026-08-18T12:00:00Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe('sinceWhen', () => {
  it('says just now rather than counting the first minute', () => {
    expect(sinceWhen(ago(0), NOW)).toBe('just now');
    expect(sinceWhen(ago(45), NOW)).toBe('just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(sinceWhen(ago(120), NOW)).toBe('2 minutes ago');
    expect(sinceWhen(ago(3 * 3600), NOW)).toBe('3 hours ago');
    expect(sinceWhen(ago(3 * 86_400), NOW)).toBe('3 days ago');
  });

  it('uses the singular for exactly one of anything', () => {
    expect(sinceWhen(ago(120 + 30), NOW)).toBe('3 minutes ago');
    expect(sinceWhen(ago(3600), NOW)).toBe('1 hour ago');
    expect(sinceWhen(ago(86_400), NOW)).toBe('1 day ago');
    expect(sinceWhen(ago(31 * 86_400), NOW)).toBe('1 month ago');
    expect(sinceWhen(ago(400 * 86_400), NOW)).toBe('1 year ago');
  });

  it('never counts hours past a day or days past a month', () => {
    expect(sinceWhen(ago(25 * 3600), NOW)).toBe('1 day ago');
    expect(sinceWhen(ago(60 * 86_400), NOW)).toBe('2 months ago');
  });

  it('does not run backwards on a clock that disagrees', () => {
    // Two machines' clocks differ, and a file stamped in the near future must
    // not read as "minus three minutes ago".
    expect(sinceWhen(new Date(NOW.getTime() + 60_000), NOW)).toBe('just now');
  });
});
