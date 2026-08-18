/**
 * Turning a title into an address.
 *
 * Its own file, with no database import in it, because the authoring screens
 * show the address as it is typed and a client component importing
 * src/lib/catalog/authoring.ts would drag drizzle and the whole schema into
 * the browser bundle to get one string function.
 *
 * The server derives the slug it stores with this same function rather than
 * trusting what the page displayed, so the line under the title field is a
 * preview of the real answer and not a second implementation of it.
 */

/** Lowercase, hyphenated, and nothing that would need escaping in a URL. */
export function toSlug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
