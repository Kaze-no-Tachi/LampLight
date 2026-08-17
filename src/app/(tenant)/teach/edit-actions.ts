'use server';

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import {
  auditLog,
  courseResources,
  courses,
  lessonResources,
  lessons,
  modules,
} from '@/db/schema';
import {
  decideCourseAuthoring,
  decideLessonAuthoring,
  decideModuleAuthoring,
} from '@/lib/access/authoring';
import { requireViewer } from '@/lib/auth/guards';
import { checkUpload } from '@/lib/media/uploads';
import { signObjectWrite, statObject, storageConfigured } from '@/lib/storage';
import { buildObjectKey } from '@/lib/storage/keys';
import { deleteObject } from '@/lib/storage';

/**
 * Editing what a course and a lesson actually say.
 *
 * Everything here was schema and a public page with no way to change it: a
 * course description, a lesson's notes, a syllabus, a handout. An institute
 * could be given a site it could not write, which is not a product.
 *
 * Same rules as the rest of teaching. The viewer is re-established, the
 * authoring predicate is re-asked with the id from the form, and denial is the
 * same message whether the thing is not theirs or does not exist.
 */

export type EditResult =
  { status: 'ok' } | { status: 'error'; message: string };

/**
 * The same answer whether the thing is not yours or does not exist, matching
 * the 404 rule everywhere else: an instructor probing ids learns nothing.
 */
const DENIED_MESSAGE = 'That is not available to you.';
const DENIED: EditResult = { status: 'error', message: DENIED_MESSAGE };

/** Long enough for a real description, short enough to stay a description. */
const MAX_DESCRIPTION = 20_000;
const MAX_TITLE = 200;

export async function updateCourseAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const courseId = String(formData.get('courseId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const descriptionMd = String(formData.get('descriptionMd') ?? '').trim();

  if (title.length < 2 || title.length > MAX_TITLE) {
    return { status: 'error', message: 'A course needs a title.' };
  }
  if (descriptionMd.length > MAX_DESCRIPTION) {
    return { status: 'error', message: 'That description is too long.' };
  }

  const done = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return false;

    await scope.tx
      .update(courses)
      .set({ title, descriptionMd: descriptionMd || null })
      .where(
        and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)),
      );

    return true;
  });

  if (!done) return DENIED;

  revalidatePath('/teach');
  revalidatePath(`/teach/courses/${courseId}`);
  // The catalog and the course page both read this.
  revalidatePath('/courses', 'layout');
  return { status: 'ok' };
}

export async function updateLessonAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const lessonId = String(formData.get('lessonId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const contentMd = String(formData.get('contentMd') ?? '').trim();
  const isFreePreview = String(formData.get('isFreePreview') ?? '') === 'true';

  if (title.length < 2 || title.length > MAX_TITLE) {
    return { status: 'error', message: 'A lesson needs a title.' };
  }
  if (contentMd.length > MAX_DESCRIPTION) {
    return { status: 'error', message: 'Those notes are too long.' };
  }

  const done = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideLessonAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      lessonId,
    );
    if (!decision.allowed) return false;

    await scope.tx
      .update(lessons)
      .set({ title, contentMd: contentMd || null, isFreePreview })
      .where(
        and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, lessonId)),
      );

    // Opening a lesson to the public is a decision about who can hear what,
    // so it is recorded like every other one of those.
    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'lesson.updated',
      targetType: 'lesson',
      targetId: lessonId,
      metadataJson: { isFreePreview },
    });

    return true;
  });

  if (!done) return DENIED;

  revalidatePath('/teach');
  revalidatePath(`/teach/lessons/${lessonId}`);
  revalidatePath(`/lessons/${lessonId}`);
  return { status: 'ok' };
}

export async function updateModuleAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const moduleId = String(formData.get('moduleId') ?? '');
  const title = String(formData.get('title') ?? '').trim();

  if (title.length < 2 || title.length > MAX_TITLE) {
    return { status: 'error', message: 'A section needs a title.' };
  }

  const done = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideModuleAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      moduleId,
    );
    if (!decision.allowed) return false;

    await scope.tx
      .update(modules)
      .set({ title })
      .where(
        and(eq(modules.tenantId, scope.tenantId), eq(modules.id, moduleId)),
      );

    return true;
  });

  return done ? { status: 'ok' } : DENIED;
}

/**
 * Attaches a link to a course: a reading list, a bookstore page, a form.
 *
 * A link needs no upload and no storage, which is why an institute with no
 * bucket configured can still put a syllabus on a course. Only http and https,
 * checked here rather than at render time, because a javascript: URL stored in
 * the database is a trap waiting for whoever writes the next page that renders
 * it without thinking.
 */
export async function addCourseLinkAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const courseId = String(formData.get('courseId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const url = String(formData.get('url') ?? '').trim();
  const isPublic = String(formData.get('isPublic') ?? '') === 'true';

  if (!title) return { status: 'error', message: 'Give the link a name.' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 'error', message: 'That is not a web address.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { status: 'error', message: 'Links must start with https.' };
  }

  const done = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return false;

    await scope.tx.insert(courseResources).values({
      tenantId: scope.tenantId,
      courseId,
      kind: 'link',
      title,
      url: parsed.toString(),
      isPublic,
      sortOrder: 0,
    });

    return true;
  });

  if (!done) return DENIED;

  revalidatePath(`/teach/courses/${courseId}`);
  revalidatePath('/courses', 'layout');
  return { status: 'ok' };
}

export type DocumentTicket =
  | {
      status: 'ok';
      uploadUrl: string;
      resourceId: string;
      contentType: string;
    }
  | { status: 'error'; message: string };

/**
 * A presigned PUT for a course handout, and the row it will fill.
 *
 * The same three-step shape as an audio upload: reserve, send straight to the
 * bucket, then confirm against the bucket. byte_size stays null until it is
 * confirmed, and the course page only offers documents that have one.
 */
export async function requestDocumentUploadAction(
  formData: FormData,
): Promise<DocumentTicket> {
  const viewer = await requireViewer();
  const courseId = String(formData.get('courseId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const filename = String(formData.get('filename') ?? 'document.pdf');
  const isPublic = String(formData.get('isPublic') ?? '') === 'true';

  if (!storageConfigured()) {
    return {
      status: 'error',
      message:
        'File storage is not configured here. Add the document as a link instead.',
    };
  }

  const check = checkUpload({
    kind: 'document',
    contentType: String(formData.get('contentType') ?? ''),
    byteSize: Number(formData.get('byteSize') ?? 0),
  });
  if (!check.ok) return { status: 'error', message: check.message };

  const resourceId = randomUUID();

  const key = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return null;

    const objectKey = buildObjectKey({
      tenantId: scope.tenantId,
      purpose: 'lesson',
      objectId: resourceId,
      filename,
    });

    await scope.tx.insert(courseResources).values({
      id: resourceId,
      tenantId: scope.tenantId,
      courseId,
      kind: 'pdf',
      title: title || filename,
      storageKey: objectKey,
      filename,
      byteSize: null,
      isPublic,
      sortOrder: 0,
    });

    return objectKey;
  });

  if (!key) return { status: 'error', message: DENIED_MESSAGE };

  const signed = await signObjectWrite(
    viewer.tenant.id,
    key,
    check.contentType,
  );

  return {
    status: 'ok',
    uploadUrl: signed.url,
    resourceId,
    contentType: check.contentType,
  };
}

export async function completeDocumentUploadAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const resourceId = String(formData.get('resourceId') ?? '');
  const courseId = String(formData.get('courseId') ?? '');

  const key = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return null;

    const rows = await scope.tx
      .select({ storageKey: courseResources.storageKey })
      .from(courseResources)
      .where(
        and(
          eq(courseResources.tenantId, scope.tenantId),
          eq(courseResources.id, resourceId),
          eq(courseResources.courseId, courseId),
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
    kind: 'document',
    contentType: facts.contentType ?? '',
    byteSize: facts.byteSize,
  });
  if (!check.ok) {
    await deleteObject(viewer.tenant.id, key);
    return { status: 'error', message: check.message };
  }

  await getTenantDb(viewer.tenant.id).run(async (scope) => {
    await scope.tx
      .update(courseResources)
      .set({ byteSize: facts.byteSize })
      .where(
        and(
          eq(courseResources.tenantId, scope.tenantId),
          eq(courseResources.id, resourceId),
        ),
      );
  });

  revalidatePath(`/teach/courses/${courseId}`);
  revalidatePath('/courses', 'layout');
  return { status: 'ok' };
}

export async function removeCourseResourceAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const resourceId = String(formData.get('resourceId') ?? '');
  const courseId = String(formData.get('courseId') ?? '');

  const key = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideCourseAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      courseId,
    );
    if (!decision.allowed) return undefined;

    const rows = await scope.tx
      .select({ storageKey: courseResources.storageKey })
      .from(courseResources)
      .where(
        and(
          eq(courseResources.tenantId, scope.tenantId),
          eq(courseResources.id, resourceId),
          eq(courseResources.courseId, courseId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return undefined;

    await scope.tx
      .delete(courseResources)
      .where(
        and(
          eq(courseResources.tenantId, scope.tenantId),
          eq(courseResources.id, resourceId),
        ),
      );

    return rows[0]?.storageKey ?? null;
  });

  if (key === undefined) return DENIED;

  // A link has no object. An uploaded document does, and it goes too.
  if (key && storageConfigured()) {
    try {
      await deleteObject(viewer.tenant.id, key);
    } catch {
      // Left for the operator; the document is already gone from the site.
    }
  }

  revalidatePath(`/teach/courses/${courseId}`);
  revalidatePath('/courses', 'layout');
  return { status: 'ok' };
}

/**
 * Attaches a handout to a single lesson, as a link.
 *
 * Lesson documents are gated by the access predicate exactly as the audio is,
 * because a lesson handout is as much a thing somebody paid for as the
 * recording. Uploaded lesson documents go through the audio path's cousin;
 * this is the no-storage-needed case.
 */
export async function addLessonLinkAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const lessonId = String(formData.get('lessonId') ?? '');
  const url = String(formData.get('url') ?? '').trim();
  const filename = String(formData.get('title') ?? '').trim();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 'error', message: 'That is not a web address.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { status: 'error', message: 'Links must start with https.' };
  }

  const done = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const decision = await decideLessonAuthoring(
      scope,
      { tenantId: viewer.tenant.id, userId: viewer.userId },
      lessonId,
    );
    if (!decision.allowed) return false;

    await scope.tx.insert(lessonResources).values({
      tenantId: scope.tenantId,
      lessonId,
      kind: 'link',
      url: parsed.toString(),
      filename: filename || parsed.hostname,
      // A link has no object, so there is nothing to confirm and nothing that
      // could be missing. Marked ready immediately, with a size of zero.
      byteSize: 0,
      isDownloadable: true,
      sortOrder: 1,
    });

    return true;
  });

  if (!done) return DENIED;

  revalidatePath(`/teach/lessons/${lessonId}`);
  revalidatePath(`/lessons/${lessonId}`);
  return { status: 'ok' };
}
