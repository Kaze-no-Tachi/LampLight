/**
 * Formatting shared by the catalog and the course page.
 *
 * Here rather than duplicated per page because these strings are the design:
 * "12 lessons · 9 hours" reads as one thing across the catalog, the course
 * page and the teaching list, and three copies of the logic drift into three
 * slightly different sentences.
 */

/**
 * Programs carry no currency column of their own, unlike courses, so callers
 * default where one is not supplied. Multi-currency is a P2 in the PRD, and
 * when it lands the currency belongs on the product rather than being passed
 * in at the call site.
 */
export function money(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    // Whole-dollar prices read as "$299" rather than "$299.00", which is what
    // the design shows. A price with cents still shows them.
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "1 lesson" / "12 lessons". */
export function lessonCount(count: number): string {
  return `${count} ${count === 1 ? 'lesson' : 'lessons'}`;
}

/**
 * Running time, rounded the way someone deciding whether to start tonight
 * would think about it: minutes below an hour, then hours to one decimal.
 *
 * Returns null when nothing has a duration yet, so callers can leave the
 * clause out rather than print "0 hours" on a course that simply has no audio
 * uploaded.
 */
export function runningTime(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = seconds / 3600;
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
}

/** "12 lessons · 9 hours", dropping the clause that has nothing to say. */
export function courseMeta(
  lessons: number,
  durationSeconds: number | null,
): string {
  const time = runningTime(durationSeconds);
  const parts = [lessonCount(lessons)];
  if (time) parts.push(`${time} of audio`);
  parts.push('self-paced');
  return parts.join(' · ');
}

/** "34:12", or "1:04:30" once past an hour. Used for lesson durations. */
export function timecode(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;

  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/**
 * The first readable sentence of a markdown description, as plain text.
 *
 * The catalog shows a blurb, not a rendered document, so this deliberately
 * strips rather than renders. It drops a leading heading because the seeded
 * and authored descriptions both start by repeating the course title, which is
 * already the line above it on every surface that calls this.
 */
export function excerpt(markdown: string | null, limit = 180): string {
  if (!markdown) return '';

  const text = markdown
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join(' ')
    // Inline markup, reduced to the words inside it.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= limit) return text;
  // Cut on a word boundary so the ellipsis does not land mid-word.
  const clipped = text.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 0 ? lastSpace : limit).trimEnd()}…`;
}
