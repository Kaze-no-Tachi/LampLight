'use server';

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { auditLog, lessonResources, lessons, modules } from '@/db/schema';
import {
  decideCourseAuthoring,
  decideLessonAuthoring,
} from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import { buildObjectKey } from '@/lib/storage/keys';
import { signObjectWrite, storageConfigured } from '@/lib/storage';

/**
 * Instructor content management (PRD requirement P0-10).
 *
 * Every action re-establishes the viewer and re-asks the authoring predicate.
 * A server action is a public endpoint that happens to be called from a form,
 * so nothing here trusts an id because a page rendered it: the same person can
 * call this with any course id they like, and the predicate is what decides.
 *
 * The tenant always comes from the resolved Host header, never from the body.
 */

export type ActionResult =
  { status: 'ok' } | { status: 'error'; message: string };

const DENIED: ActionResult = {
  // Deliberately the same message for "not yours" and "does not exist", to
  // match the 404 rule everywhere else. An instructor probing course ids
  // learns nothing about what else the institute teaches.
  status: 'error',
  message: 'That course is not available to you.',
};

export async function addModuleAction(
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const courseId = String(formData.get('courseId') ?? '');
  const title = String(formData.get('title') ?? '').trim();

  if (!title) return { status: 'error', message: 'A title is required.' };

  const done = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return false;

    // Appended, so a new module does not reorder the ones already there.
    const next = await scope.tx
      .select({
        next: sql<number>`coalesce(max(${modules.sortOrder}), -1) + 1`,
      })
      .from(modules)
      .where(
        and(
          eq(modules.tenantId, scope.tenantId),
          eq(modules.courseId, courseId),
        ),
      );

    await scope.tx.insert(modules).values({
      tenantId: scope.tenantId,
      courseId,
      title,
      sortOrder: next[0]?.next ?? 0,
    });

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'module.created',
      targetType: 'course',
      targetId: courseId,
      metadataJson: { title },
    });

    return true;
  });

  if (!done) return DENIED;

  revalidatePath('/teach');
  return { status: 'ok' };
}

export async function addLessonAction(
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const moduleId = String(formData.get('moduleId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const isFreePreview = formData.get('isFreePreview') !== null;

  if (!title) return { status: 'error', message: 'A title is required.' };

  const done = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    // Resolved through the module to its course, so the check is against the
    // course the module actually belongs to.
    const owning = await scope.tx
      .select({ courseId: modules.courseId })
      .from(modules)
      .where(
        and(eq(modules.tenantId, scope.tenantId), eq(modules.id, moduleId)),
      )
      .limit(1);

    const courseId = owning[0]?.courseId;
    if (!courseId) return false;

    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return false;

    const next = await scope.tx
      .select({
        next: sql<number>`coalesce(max(${lessons.sortOrder}), -1) + 1`,
      })
      .from(lessons)
      .where(
        and(
          eq(lessons.tenantId, scope.tenantId),
          eq(lessons.moduleId, moduleId),
        ),
      );

    await scope.tx.insert(lessons).values({
      tenantId: scope.tenantId,
      moduleId,
      title,
      slug: slugify(title),
      isFreePreview,
      sortOrder: next[0]?.next ?? 0,
    });

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'lesson.created',
      targetType: 'module',
      targetId: moduleId,
      metadataJson: { title, isFreePreview },
    });

    return true;
  });

  if (!done) return DENIED;

  revalidatePath('/teach');
  return { status: 'ok' };
}

export type UploadTicket =
  | {
      status: 'ok';
      uploadUrl: string;
      resourceId: string;
      /** So the browser sends the type that was signed, and not another. */
      contentType: string;
    }
  | { status: 'error'; message: string };

/**
 * Issues a presigned PUT for a lesson's audio, and the row it will fill.
 *
 * THE KEY IS BUILT HERE, NOT SENT BY THE BROWSER.
 *
 * A presigned PUT whose key came from the client is an arbitrary write into
 * the bucket, and on a shared bucket that means an arbitrary write into
 * another institute's prefix. The browser sends a filename, which is
 * sanitised, and nothing else that reaches the key.
 *
 * The row is written before the upload rather than after, so a file that
 * arrives in the bucket always has something pointing at it. The opposite
 * order loses track of an object when the browser dies mid-request, and an
 * unreferenced object in a shared bucket is one nobody will ever clean up.
 */
export async function requestUploadAction(
  formData: FormData,
): Promise<UploadTicket> {
  const viewer = await requireViewer();
  const lessonId = String(formData.get('lessonId') ?? '');
  const filename = String(formData.get('filename') ?? 'audio.mp3');
  const contentType = String(formData.get('contentType') ?? 'audio/mpeg');

  if (!storageConfigured()) {
    return {
      status: 'error',
      message: 'Media storage is not configured on this instance.',
    };
  }

  if (!contentType.startsWith('audio/')) {
    return { status: 'error', message: 'Only audio uploads are supported.' };
  }

  const resourceId = randomUUID();

  const key = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideLessonAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      lessonId,
    );
    if (!decision.allowed) return null;

    const objectKey = buildObjectKey({
      tenantId: scope.tenantId,
      purpose: 'lesson',
      objectId: resourceId,
      filename,
    });

    await scope.tx.insert(lessonResources).values({
      id: resourceId,
      tenantId: scope.tenantId,
      lessonId,
      kind: 'audio',
      storageKey: objectKey,
      filename,
      isDownloadable: false,
      sortOrder: 0,
    });

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'lesson_resource.upload_requested',
      targetType: 'lesson',
      targetId: lessonId,
      metadataJson: { filename },
    });

    return objectKey;
  });

  if (!key) {
    return { status: 'error', message: 'That lesson is not available to you.' };
  }

  const signed = await signObjectWrite(viewer.tenant.id, key, contentType);

  return {
    status: 'ok',
    uploadUrl: signed.url,
    resourceId,
    contentType,
  };
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'lesson'
  );
}
