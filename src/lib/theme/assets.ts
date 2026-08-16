/**
 * Where a logo or favicon is allowed to come from.
 *
 * An institute types this into a settings field, and it ends up in the src of
 * an element on every page of their domain, so the scheme matters. A
 * javascript: URL in an href runs; a data: URL can carry an SVG, and an SVG is
 * a document that can carry script. Neither is a logo.
 *
 * Two forms are allowed: an https URL, which is where a hosted logo lives, and
 * a same-origin path, which is what an uploaded object will be served on once
 * uploads land. http is refused even in development, because a mixed-content
 * image is a broken image on the institute's live site and it is better to
 * find that in the settings form than in production.
 */
export function safeAssetUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // A same-origin path. The second character check refuses "//host", which is
  // protocol-relative and therefore not same-origin at all.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    // No control characters, and no way to end the attribute early. React
    // escapes attribute values, so this is belt and braces rather than the
    // only defence.
    return /^[\w\-./~%]+$/.test(trimmed.slice(1)) ? trimmed : null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
