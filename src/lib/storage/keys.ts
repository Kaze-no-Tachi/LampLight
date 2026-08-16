/**
 * Object keys, and the one rule that keeps institutes apart in the bucket.
 *
 * There is one bucket. Every object belonging to an institute lives under
 * `t/{tenant_id}/`, so the prefix is the isolation boundary, exactly as
 * `tenant_id` is in Postgres. The difference is that Postgres has row-level
 * security underneath the application filter and object storage has nothing:
 * a wrong prefix is a wrong object, with no second layer to catch it.
 *
 * So the rules here are absolute, and they are pure functions so they can be
 * tested exhaustively without a bucket.
 *
 *   A key is BUILT from a tenant id plus a caller-supplied name, never
 *   accepted whole from a client. A client that can name a key can name
 *   another institute's.
 *
 *   A key is VERIFIED before it is signed, against the tenant the request
 *   resolved to. Belt and braces: the builder should make a wrong key
 *   impossible, and the verifier assumes one day it will not.
 *
 *   A key that does not belong is refused, never rewritten. Silently
 *   correcting a bad key hides the bug that produced it.
 */

const TENANT_ROOT = 't';

/** Characters a stored filename may keep. Everything else becomes a hyphen. */
const SAFE_FILENAME = /[^a-zA-Z0-9._-]+/g;

export type MediaPurpose = 'lesson' | 'branding';

/**
 * The prefix every one of an institute's objects sits under.
 *
 * Trailing slash included deliberately: without it, `t/abc` is a prefix of
 * `t/abcdef`, and a check written as "starts with the prefix" would let one
 * institute read another whose id happens to extend theirs. Uuids make that
 * impossible in practice, and relying on "in practice" for an isolation
 * boundary is how it stops being true.
 */
export function tenantPrefix(tenantId: string): string {
  return `${TENANT_ROOT}/${tenantId}/`;
}

/**
 * Builds a key inside an institute's prefix.
 *
 * The filename is sanitised rather than trusted. It reaches this function from
 * an upload form, so it can contain path traversal, a leading slash, control
 * characters, or a name long enough to be a problem on its own.
 */
export function buildObjectKey(params: {
  tenantId: string;
  purpose: MediaPurpose;
  /** A unique id for this object, usually the resource row's uuid. */
  objectId: string;
  filename: string;
}): string {
  const safe = sanitizeFilename(params.filename);
  return `${tenantPrefix(params.tenantId)}${params.purpose}/${params.objectId}/${safe}`;
}

/**
 * Whether a key belongs to this institute.
 *
 * The check every signer runs before signing anything. `..` is rejected
 * outright rather than resolved, because a key containing it may mean
 * something different to the storage provider than it does to us, and the
 * safest reading of an ambiguous key is to refuse it.
 */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  if (!key || key.includes('..')) return false;
  if (key.startsWith('/')) return false;
  return key.startsWith(tenantPrefix(tenantId));
}

/**
 * Strips a filename down to something safe to put in a key.
 *
 * Not for display. The original filename is kept in the database column, which
 * is where it should be shown from, so this only has to be safe rather than
 * faithful.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(SAFE_FILENAME, '-')
    // Collapse runs, so "Lecture 01 - Genesis" does not become
    // "Lecture-01---Genesis". Cosmetic, but these end up in URLs an institute
    // sees.
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+$/, '');
  const trimmed = cleaned.slice(0, 120);
  return trimmed || 'file';
}
