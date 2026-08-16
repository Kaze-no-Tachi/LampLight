import { getTenantDb } from '@/db/client';
import { listLessonResources } from '@/db/repositories/lessons';
import { signObjectRead, type StorageSigner } from '@/lib/storage';
import { decideLessonAccess, type AccessContext } from './predicate';

/**
 * Signed media issuance (PRD requirement P0-9).
 *
 * This is the only place in the codebase that turns a lesson resource into a
 * URL somebody can fetch, and it is the only caller of the access predicate
 * that matters, because everything else the predicate guards is a page that
 * can be re-rendered. A URL cannot be un-issued.
 *
 * THE ORDER IS THE POINT
 *
 * Predicate first, resource lookup second, signature third. Written the other
 * way round, a resource id that belongs to a lesson somebody may not hear
 * still gets looked up, and the difference between "no such resource" and
 * "not for you" starts leaking through timing and through whatever the code
 * does next. Here the two are the same code path: null.
 *
 * Both happen inside one tenant scope, so the lesson, its resources, and the
 * membership behind the decision all come from one consistent snapshot, and
 * row-level security applies to every one of them.
 */

export type IssuedMedia = {
  readonly resourceId: string;
  readonly kind: 'audio' | 'video' | 'pdf' | 'link';
  readonly filename: string | null;
  readonly isDownloadable: boolean;
  readonly url: string;
  readonly expiresAt: Date;
};

/**
 * Issues signed URLs for every playable resource on a lesson, or null.
 *
 * Null covers every refusal: the lesson belongs to another institute, does not
 * exist, is gated and the viewer has no entitlement, or the viewer is not
 * signed in. Callers render the same 404 for all of them, so a student cannot
 * map an institute's catalog by watching which ids answer differently.
 */
export async function issueLessonMedia(
  ctx: AccessContext,
  lessonId: string,
  signer: StorageSigner | null = null,
): Promise<IssuedMedia[] | null> {
  const resources = await getTenantDb(ctx.tenantId).run(async (scope) => {
    const decision = await decideLessonAccess(scope, ctx, lessonId);
    if (!decision.allowed) return null;

    return listLessonResources(scope, lessonId);
  });

  if (!resources) return null;

  const issued: IssuedMedia[] = [];

  for (const resource of resources) {
    // A link resource is somebody else's URL, stored as a key-less row. There
    // is nothing of ours to sign, and signing it would be meaningless anyway.
    if (!resource.storageKey) continue;

    const signed = await signObjectRead(
      ctx.tenantId,
      resource.storageKey,
      signer,
    );

    issued.push({
      resourceId: resource.id,
      kind: resource.kind,
      filename: resource.filename,
      isDownloadable: resource.isDownloadable,
      url: signed.url,
      expiresAt: signed.expiresAt,
    });
  }

  return issued;
}
