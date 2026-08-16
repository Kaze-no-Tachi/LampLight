/**
 * The words an institute puts on its own pages (PRD section 9).
 *
 * Same shape of rule as the theme tokens: a fixed set of keys, so nothing an
 * admin types can decide *where* it lands, only what it says. Values are plain
 * text and are rendered as React children, which escapes them, so there is no
 * markup path here at all. The one field that takes markdown is the course
 * description, which goes through src/lib/markdown/render.tsx and its own
 * subset.
 *
 * Lengths are capped because these strings sit in a header and a hero and an
 * institute pasting three paragraphs into a tagline should get a truncated
 * tagline rather than a broken page.
 */

export const COPY_KEYS = ['tagline', 'hero', 'about', 'footer'] as const;
export type CopyKey = (typeof COPY_KEYS)[number];

const LIMITS: Record<CopyKey, number> = {
  tagline: 120,
  hero: 240,
  about: 800,
  footer: 200,
};

export type CopySettings = Record<CopyKey, string | null>;

export const EMPTY_COPY: CopySettings = {
  tagline: null,
  hero: null,
  about: null,
  footer: null,
};

/**
 * Reads copy_json into the editable shape.
 *
 * Fails open like parseTheme: an unknown key is dropped, a non-string is
 * dropped, and anything over the limit is truncated rather than refused, so a
 * long paste does not lose the whole field.
 */
export function parseCopy(input: unknown): CopySettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return EMPTY_COPY;
  }

  const record = input as Record<string, unknown>;
  const copy: CopySettings = { ...EMPTY_COPY };

  for (const key of COPY_KEYS) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    // Collapses runs of whitespace, since these are single-line-ish fields and
    // a pasted newline otherwise leaves a gap the admin cannot see in the form.
    const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, LIMITS[key]);
    if (cleaned) copy[key] = cleaned;
  }

  return copy;
}

/**
 * The copy actually rendered: the institute's own words where it has written
 * any, and a sentence built from its name where it has not.
 *
 * Defaults are here rather than in the seed so that an institute created
 * tomorrow has a home page that reads properly before anybody has been in to
 * write one.
 */
export function copyFor(
  instituteName: string,
  copy: CopySettings,
): Record<CopyKey, string> {
  return {
    tagline: copy.tagline ?? 'Study at your own pace.',
    hero: copy.hero ?? `Courses from ${instituteName}.`,
    about:
      copy.about ??
      `${instituteName} offers audio courses and structured programs of study. ` +
        'Enrol in a single course, or work through a whole program.',
    footer: copy.footer ?? instituteName,
  };
}

/** Serialises the editable shape back to what copy_json should hold. */
export function serializeCopy(copy: CopySettings): Record<string, string> {
  const json: Record<string, string> = {};
  for (const key of COPY_KEYS) {
    const value = copy[key];
    if (value) json[key] = value;
  }
  return json;
}
