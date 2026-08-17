import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getTenantDb } from '@/db/client';
import { auditLog, courseResources, lessonResources } from '@/db/schema';
import {
  decideCourseAuthoring,
  decideLessonAuthoring,
} from '@/lib/access/authoring';
import { checkUpload } from '@/lib/media/uploads';
import {
  deleteObject,
  signObjectWrite,
  statObject,
  storageConfigured,
} from '@/lib/storage';
import { buildObjectKey } from '@/lib/storage/keys';

/**
 * Attaching a document to a course or to a lesson.
 *
 * ONE IMPLEMENTATION, TWO PLACES IT LANDS
 *
 * Course handouts and lesson materials differ in exactly two ways: which table
 * the row goes in, and which predicate decides. Everything else is identical
 * and is the part that is easy to get wrong: build the key server-side, reserve
 * a row, sign a PUT for a type the caller declared, and afterwards go and ask
 * the bucket whether the object is really there before anybody is offered it.
 *
 * The first version of lesson materials was links only, precisely to avoid
 * writing that sequence twice. This is the other answer: write it once.
 *
 * WHY UPLOADS RATHER THAN LINKS EVERYWHERE
 *
 * A link is somebody else's uptime, somebody else's access control, and
 * somebody else's decision about whether the file still exists next year. An
 * institute that keeps its reading list on a church website loses it when the
 * church redesigns. Both are offered; the upload is the one that keeps a
 * course whole.
 *
 * Audio is deliberately not routed through here. It carries two behaviours a
 * document does not (replacing the previous recording, and recording the
 * duration the browser measured), and folding those in would make this the
 * union of two things rather than the intersection.
 */

export type AttachmentTarget =
  { kind: 'course'; id: string } | { kind: 'lesson'; id: string };

export type AttachmentContext = {
  readonly tenantId: string;
  readonly actorUserId: string;
};

export type ReserveResult =
  | {
      status: 'ok';
      resourceId: string;
      uploadUrl: string;
      contentType: string;
    }
  | { status: 'error'; message: string };

export type AttachResult =
  { status: 'ok' } | { status: 'error'; message: string };

/** Same answer for "not yours" and "does not exist", as everywhere else. */
const DENIED = 'That is not available to you.';

/**
 * Reserves a row and issues a presigned PUT.
 *
 * The key is built here from the tenant and a fresh resource id. A key that
 * came from the browser would be an arbitrary write into a shared bucket,
 * which is an arbitrary write into another institute's prefix.
 */
export async function reserveAttachment(
  ctx: AttachmentContext,
  target: AttachmentTarget,
  file: {
    filename: string;
    contentType: string;
    byteSize: number;
    title?: string;
    isPublic?: boolean;
  },
): Promise<ReserveResult> {
  if (!storageConfigured()) {
    return {
      status: 'error',
      message: 'File storage is not configured here. Add it as a link instead.',
    };
  }

  const check = checkUpload({
    kind: 'document',
    contentType: file.contentType,
    byteSize: file.byteSize,
  });
  if (!check.ok) return { status: 'error', message: check.message };

  const resourceId = randomUUID();

  const key = await getTenantDb(ctx.tenantId).run(async (scope) => {
    if (!(await mayAuthor(scope, ctx, target))) return null;

    const objectKey = buildObjectKey({
      tenantId: scope.tenantId,
      purpose: 'lesson',
      objectId: resourceId,
      filename: file.filename,
    });

    if (target.kind === 'course') {
      await scope.tx.insert(courseResources).values({
        id: resourceId,
        tenantId: scope.tenantId,
        courseId: target.id,
        kind: 'pdf',
        title: file.title || file.filename,
        storageKey: objectKey,
        filename: file.filename,
        // Null until confirmed. Every read that offers a document to a student
        // filters on this, so an upload that never lands stays invisible.
        byteSize: null,
        isPublic: file.isPublic ?? false,
        sortOrder: 0,
      });
    } else {
      await scope.tx.insert(lessonResources).values({
        id: resourceId,
        tenantId: scope.tenantId,
        lessonId: target.id,
        kind: 'pdf',
        storageKey: objectKey,
        filename: file.title || file.filename,
        byteSize: null,
        isDownloadable: true,
        sortOrder: 1,
      });
    }

    return objectKey;
  });

  if (!key) return { status: 'error', message: DENIED };

  const signed = await signObjectWrite(ctx.tenantId, key, check.contentType);

  return {
    status: 'ok',
    resourceId,
    uploadUrl: signed.url,
    contentType: check.contentType,
  };
}

/**
 * Asks the bucket whether the upload arrived, and only then makes it visible.
 *
 * The bytes went straight from the browser to storage, so the application was
 * not in the path and knows nothing. The browser saying it worked is not
 * evidence: it can crash, lose the connection after the last chunk, or lie.
 */
export async function confirmAttachment(
  ctx: AttachmentContext,
  target: AttachmentTarget,
  resourceId: string,
): Promise<AttachResult> {
  const key = await getTenantDb(ctx.tenantId).run(async (scope) => {
    if (!(await mayAuthor(scope, ctx, target))) return null;
    return findKey(scope, target, resourceId);
  });

  if (!key) return { status: 'error', message: DENIED };

  const facts = await statObject(ctx.tenantId, key);
  if (!facts) {
    return {
      status: 'error',
      message: 'That upload did not arrive. Try sending the file again.',
    };
  }

  const check = checkUpload({
    kind: 'document',
    contentType: facts.contentType ?? '',
    byteSize: facts.byteSize,
  });
  if (!check.ok) {
    // Real object, wrong thing: the signed PUT was used for something other
    // than what was declared. It does not get to stay.
    await deleteObject(ctx.tenantId, key);
    return { status: 'error', message: check.message };
  }

  await getTenantDb(ctx.tenantId).run(async (scope) => {
    if (target.kind === 'course') {
      await scope.tx
        .update(courseResources)
        .set({ byteSize: facts.byteSize })
        .where(
          and(
            eq(courseResources.tenantId, scope.tenantId),
            eq(courseResources.id, resourceId),
          ),
        );
    } else {
      await scope.tx
        .update(lessonResources)
        .set({ byteSize: facts.byteSize })
        .where(
          and(
            eq(lessonResources.tenantId, scope.tenantId),
            eq(lessonResources.id, resourceId),
          ),
        );
    }

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: ctx.actorUserId,
      action: 'attachment.uploaded',
      targetType: target.kind,
      targetId: target.id,
      metadataJson: { resourceId, byteSize: facts.byteSize },
    });
  });

  return { status: 'ok' };
}

/** Removes an attachment, object first, then the row. */
export async function removeAttachment(
  ctx: AttachmentContext,
  target: AttachmentTarget,
  resourceId: string,
): Promise<AttachResult> {
  const key = await getTenantDb(ctx.tenantId).run(async (scope) => {
    if (!(await mayAuthor(scope, ctx, target))) return undefined;

    const found = await findKey(scope, target, resourceId);
    if (found === undefined) return undefined;

    if (target.kind === 'course') {
      await scope.tx
        .delete(courseResources)
        .where(
          and(
            eq(courseResources.tenantId, scope.tenantId),
            eq(courseResources.id, resourceId),
          ),
        );
    } else {
      await scope.tx
        .delete(lessonResources)
        .where(
          and(
            eq(lessonResources.tenantId, scope.tenantId),
            eq(lessonResources.id, resourceId),
          ),
        );
    }

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: ctx.actorUserId,
      action: 'attachment.removed',
      targetType: target.kind,
      targetId: target.id,
      metadataJson: { resourceId },
    });

    return found;
  });

  if (key === undefined) return { status: 'error', message: DENIED };

  // A link has no object of its own. An uploaded document does.
  if (key && storageConfigured()) {
    try {
      await deleteObject(ctx.tenantId, key);
    } catch {
      // Left for the operator. It is already gone from the site.
    }
  }

  return { status: 'ok' };
}

type Scope = Parameters<
  Parameters<ReturnType<typeof getTenantDb>['run']>[0]
>[0];

/** Course attachments are decided by the course, lesson ones by the lesson. */
async function mayAuthor(
  scope: Scope,
  ctx: AttachmentContext,
  target: AttachmentTarget,
): Promise<boolean> {
  const author = { tenantId: ctx.tenantId, userId: ctx.actorUserId };

  const decision =
    target.kind === 'course'
      ? await decideCourseAuthoring(scope, author, target.id)
      : await decideLessonAuthoring(scope, author, target.id);

  return decision.allowed;
}

/**
 * The object key, null for a link, undefined when there is no such row here.
 *
 * The three-way answer matters: null and undefined mean different things to
 * the caller, and collapsing them would either delete nothing or report a
 * missing row as a link.
 */
async function findKey(
  scope: Scope,
  target: AttachmentTarget,
  resourceId: string,
): Promise<string | null | undefined> {
  if (target.kind === 'course') {
    const rows = await scope.tx
      .select({ storageKey: courseResources.storageKey })
      .from(courseResources)
      .where(
        and(
          eq(courseResources.tenantId, scope.tenantId),
          eq(courseResources.id, resourceId),
          // Paired with the parent, so a resource id borrowed from a course
          // this person may not touch cannot be completed by naming one they
          // may.
          eq(courseResources.courseId, target.id),
        ),
      )
      .limit(1);

    return rows.length === 0 ? undefined : (rows[0]?.storageKey ?? null);
  }

  const rows = await scope.tx
    .select({ storageKey: lessonResources.storageKey })
    .from(lessonResources)
    .where(
      and(
        eq(lessonResources.tenantId, scope.tenantId),
        eq(lessonResources.id, resourceId),
        eq(lessonResources.lessonId, target.id),
      ),
    )
    .limit(1);

  return rows.length === 0 ? undefined : (rows[0]?.storageKey ?? null);
}
