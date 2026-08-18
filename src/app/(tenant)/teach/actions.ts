'use server';

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { auditLog, lessonResources, lessons, modules } from '@/db/schema';
import {
  decideCourseAuthoring,
  decideLessonAuthoring,
} from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import { resolveModule } from '@/lib/catalog/authoring';
import { checkUpload, formatBytes, readDuration } from '@/lib/media/uploads';
import { buildObjectKey } from '@/lib/storage/keys';
import {
  deleteObject,
  signObjectWrite,
  statObject,
  storageConfigured,
} from '@/lib/storage';

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

export type AddLessonResult =
  { status: 'ok'; lessonId: string } | { status: 'error'; message: string };

/**
 * Adds a lesson to a course without anybody naming a section.
 *
 * The existing addLessonAction takes a moduleId, which is right for a course
 * that has several sections and wrong for the common case: an institute
 * writing its first course does not have a mental model of sections and should
 * not have to acquire one to add lesson two. Left to itself this resolves the
 * section, using the first one, and creates it if a course somehow has none,
 * which is true of every course made before courses came with one.
 *
 * WHERE THE SECTION CAN BE NAMED. `moduleId` files the lesson under a section
 * that already exists; `newModule` makes one and files it there. Both are
 * optional, and the add-a-lesson screen only offers either once a course has
 * more than one section to tell apart (mockup 8, and the round 2 decision that
 * a one-section course never says the word). They are also how a second
 * section gets created at all: the control for that went away with the old
 * /teach workspace in chunk 4, and addModuleAction has had no caller since.
 *
 * A moduleId from the form is checked against this course rather than
 * trusted. Without that, an instructor assigned to one course could file a
 * lesson into another course's section by editing the payload, and that other
 * course's students would then be able to hear it.
 *
 * Returns the id, because creating a lesson lands in its editor: the recording
 * and the notes are the next thing anybody does and they are not here.
 */
export async function addLessonToCourseAction(
  formData: FormData,
): Promise<AddLessonResult> {
  const viewer = await requireViewer();
  const courseId = String(formData.get('courseId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const isFreePreview = formData.get('isFreePreview') !== null;
  const askedModuleId = String(formData.get('moduleId') ?? '');
  const newModule = String(formData.get('newModule') ?? '').trim();

  if (!title) return { status: 'error', message: 'A title is required.' };

  const created = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return null;

    const moduleId = await resolveModule(scope, courseId, {
      askedModuleId,
      newModule,
    });
    if (!moduleId) return null;

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

    const [made] = await scope.tx
      .insert(lessons)
      .values({
        tenantId: scope.tenantId,
        moduleId,
        title,
        slug: slugify(title),
        isFreePreview,
        sortOrder: next[0]?.next ?? 0,
      })
      .returning({ id: lessons.id });

    return made?.id ?? null;
  });

  if (!created) {
    return { status: 'error', message: 'That course is not yours.' };
  }

  revalidatePath(`/teach/courses/${courseId}`);
  revalidatePath('/teach');
  return { status: 'ok', lessonId: created };
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

  if (!storageConfigured()) {
    return {
      status: 'error',
      message: 'Media storage is not configured on this instance.',
    };
  }

  // Checked here, and the real size checked again against the bucket in
  // completeUploadAction, because both of these numbers come from a browser.
  const check = checkUpload({
    contentType: String(formData.get('contentType') ?? ''),
    byteSize: Number(formData.get('byteSize') ?? 0),
  });
  if (!check.ok) return { status: 'error', message: check.message };
  const contentType = check.contentType;

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
      // Null until the object is confirmed to exist. That is what makes this
      // row "reserved" rather than "ready": every read that offers media to a
      // student filters on it, so an upload that never finished is invisible
      // rather than a lesson that fails to play.
      byteSize: null,
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

/**
 * Confirms an upload actually arrived, and only then makes it playable.
 *
 * WHY THE APPLICATION HAS TO ASK THE BUCKET
 *
 * The bytes go straight from the browser to object storage, which is what
 * keeps a 200 MB lecture out of the application's memory and off its
 * bandwidth bill twice over. The cost of that is that the application is not
 * in the path and does not know what happened. The browser reporting success
 * is not evidence: it can crash, lose its connection after the last chunk, or
 * simply be lying, and the earlier version of this feature believed it.
 *
 * So the row stays incomplete (byte_size null) until a HEAD against the bucket
 * says otherwise. The size stored is the bucket's, not the browser's.
 *
 * This is the same class of bug as the seeded resources that pointed at
 * objects nobody had uploaded: a row saying there is a recording, and silence
 * when a student presses play.
 */
export async function completeUploadAction(
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const resourceId = String(formData.get('resourceId') ?? '');
  const lessonId = String(formData.get('lessonId') ?? '');
  const duration = readDuration(Number(formData.get('durationSeconds') ?? 0));
  const downloadable = String(formData.get('isDownloadable') ?? '') === 'true';

  if (!storageConfigured()) {
    return {
      status: 'error',
      message: 'Media storage is not configured on this instance.',
    };
  }

  const key = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideLessonAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      lessonId,
    );
    if (!decision.allowed) return null;

    const rows = await scope.tx
      .select({ storageKey: lessonResources.storageKey })
      .from(lessonResources)
      .where(
        and(
          eq(lessonResources.tenantId, scope.tenantId),
          eq(lessonResources.id, resourceId),
          // Named with the lesson as well as the id, so a resource id from
          // another lesson this person may not teach cannot be completed by
          // pairing it with one they may.
          eq(lessonResources.lessonId, lessonId),
        ),
      )
      .limit(1);

    return rows[0]?.storageKey ?? null;
  });

  if (!key) return DENIED;

  const facts = await statObject(viewer.tenant.id, key);
  if (!facts) {
    return {
      status: 'error',
      message: 'That upload did not arrive. Try sending the file again.',
    };
  }

  const check = checkUpload({
    contentType: facts.contentType ?? '',
    byteSize: facts.byteSize,
  });
  if (!check.ok) {
    // The object is real but is not what was asked for, which means the signed
    // PUT was used for something other than the file that was declared. It
    // does not get to stay in the bucket.
    await deleteObject(viewer.tenant.id, key);
    return { status: 'error', message: check.message };
  }

  // Everything else attached to this lesson, collected before the new row is
  // marked ready so that "replace" is what the button already promised.
  const superseded = await getTenantDb(viewer.tenant.id).run((scope) =>
    scope.tx
      .select({
        id: lessonResources.id,
        storageKey: lessonResources.storageKey,
      })
      .from(lessonResources)
      .where(
        and(
          eq(lessonResources.tenantId, scope.tenantId),
          eq(lessonResources.lessonId, lessonId),
          eq(lessonResources.kind, 'audio'),
          ne(lessonResources.id, resourceId),
        ),
      ),
  );

  await getTenantDb(viewer.tenant.id).run(async (scope) => {
    await scope.tx
      .update(lessonResources)
      .set({
        byteSize: facts.byteSize,
        isDownloadable: downloadable,
      })
      .where(
        and(
          eq(lessonResources.tenantId, scope.tenantId),
          eq(lessonResources.id, resourceId),
        ),
      );

    // A duration the institute did not have before. Only written when the
    // browser managed to read one, so a failed decode leaves the old value
    // rather than blanking it.
    if (duration !== null) {
      await scope.tx
        .update(lessons)
        .set({ durationSeconds: duration })
        .where(
          and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, lessonId)),
        );
    }

    // REPLACE MEANS REPLACE.
    //
    // The button says "Replace audio" once a lesson has a recording, and an
    // earlier version simply added a second row: the instructor was told the
    // recording had been replaced, and the student carried on hearing the old
    // one, because the lesson page plays the first attachment. Found by
    // uploading a file and then listening as a student.
    //
    // Done after the new upload is confirmed present, so a failed upload can
    // never destroy the recording an institute already had.
    if (superseded.length > 0) {
      await scope.tx.delete(lessonResources).where(
        and(
          eq(lessonResources.tenantId, scope.tenantId),
          inArray(
            lessonResources.id,
            superseded.map((row) => row.id),
          ),
        ),
      );
    }

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'lesson_resource.uploaded',
      targetType: 'lesson',
      targetId: lessonId,
      metadataJson: {
        resourceId,
        byteSize: facts.byteSize,
        size: formatBytes(facts.byteSize),
        durationSeconds: duration,
        replaced: superseded.map((row) => row.id),
      },
    });
  });

  // The objects last. An object with no row is invisible but harmless; a row
  // with no object is a lesson that plays silence.
  for (const old of superseded) {
    // A link resource has no object of its own, so there is nothing to delete.
    if (!old.storageKey) continue;
    try {
      await deleteObject(viewer.tenant.id, old.storageKey);
    } catch {
      // Left for the operator. The recording is already gone as far as anybody
      // using the site is concerned.
    }
  }

  revalidatePath('/teach');
  revalidatePath(`/lessons/${lessonId}`);
  return { status: 'ok' };
}

/**
 * Removes a recording, object and row together.
 *
 * The object goes first. The other order leaves an object with nothing
 * pointing at it, which nobody will ever find again in a shared bucket, and a
 * failed delete of the row is recoverable while a lost object is not.
 */
export async function removeResourceAction(
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await requireViewer();
  const resourceId = String(formData.get('resourceId') ?? '');
  const lessonId = String(formData.get('lessonId') ?? '');

  const key = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideLessonAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      lessonId,
    );
    if (!decision.allowed) return null;

    const rows = await scope.tx
      .select({ storageKey: lessonResources.storageKey })
      .from(lessonResources)
      .where(
        and(
          eq(lessonResources.tenantId, scope.tenantId),
          eq(lessonResources.id, resourceId),
          eq(lessonResources.lessonId, lessonId),
        ),
      )
      .limit(1);

    return rows[0]?.storageKey ?? null;
  });

  if (!key) return DENIED;

  if (storageConfigured()) {
    try {
      await deleteObject(viewer.tenant.id, key);
    } catch {
      // An object that will not delete is worth knowing about, but it is not
      // a reason to keep serving a recording an instructor has removed. The
      // row goes either way and the object is left for the operator.
    }
  }

  await getTenantDb(viewer.tenant.id).run(async (scope) => {
    await scope.tx
      .delete(lessonResources)
      .where(
        and(
          eq(lessonResources.tenantId, scope.tenantId),
          eq(lessonResources.id, resourceId),
        ),
      );

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'lesson_resource.removed',
      targetType: 'lesson',
      targetId: lessonId,
      metadataJson: { resourceId, storageKey: key },
    });
  });

  revalidatePath('/teach');
  revalidatePath(`/lessons/${lessonId}`);
  return { status: 'ok' };
}
