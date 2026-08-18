/**
 * Which tenant paths are staff work, and therefore wear the sidebar shell
 * rather than the student header.
 *
 * One list, in one file, because two places deciding this is how a screen ends
 * up with both chromes or neither. The tenant layout asks it to decide whether
 * to render the header at all, and each staff page asks it for nothing: they
 * render the shell themselves and this only has to agree with them.
 *
 * Matched on prefix rather than by an exact set, so a new screen under /teach
 * or /settings is inside the shell the day it is added instead of the day
 * somebody remembers to list it. That is the safer default: a staff screen
 * without the sidebar is a dead end with no navigation, while a student screen
 * accidentally matching here would be immediately obvious.
 *
 * /account is deliberately absent. It belongs to the person rather than to
 * their job, an ordinary student has one too, and it is reached from both
 * chromes.
 */
const STAFF_PREFIXES = ['/teach', '/settings'] as const;

/**
 * Takes the path as the visitor asked for it, query string and all, which is
 * the form the middleware forwards in x-lamplight-path.
 */
export function isStaffPath(pathAndQuery: string | null | undefined): boolean {
  if (!pathAndQuery) return false;

  // The query is not part of the decision, and a path like
  // "/settings?next=/x" must not be read as anything other than /settings.
  const path = pathAndQuery.split(/[?#]/)[0] ?? '';

  return STAFF_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
