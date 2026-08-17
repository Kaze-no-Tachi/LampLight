'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { findLessonWithCourse } from '@/db/repositories/lessons';
import {
  auditLog,
  courseResources,
  courses,
  lessonResources,
  lessons,
  modules,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';
import {
  decideCourseAuthoring,
  decideLessonAuthoring,
  decideModuleAuthoring,
} from '@/lib/access/authoring';
import {
  archiveLesson,
  reorderLesson,
  setLessonPublished,
  type ReorderDirection,
} from '@/lib/catalog/authoring';
import { requireViewer } from '@/lib/auth/guards';
import {
  confirmAttachment,
  removeAttachment,
  reserveAttachment,
  type AttachmentTarget,
} from '@/lib/media/attachments';

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
  revalidatePath(`/courses/${courseId}/edit`);
  // The catalog and the course page both read this.
  revalidatePath('/catalogue', 'layout');
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

/**
 * The three lesson-lifecycle actions the unified editor's LessonList calls
 * (round 2, chunk 3). Each re-establishes the viewer, resolves the lesson to
 * its course, and asks the same authoring predicate updateLessonAction does:
 * an assigned instructor may publish, archive and reorder their own course's
 * lessons, not only edit them.
 *
 * findLessonWithCourse does not filter on publish state, which is exactly
 * right here: these actions are how a draft becomes not-a-draft, so a draft
 * has to be found in order to be published. An archived lesson is still not
 * found, matching every other page and predicate.
 */
async function findEditableLesson(
  scope: TenantScope,
  ctx: { tenantId: string; userId: string },
  lessonId: string,
) {
  const lesson = await findLessonWithCourse(scope, lessonId);
  if (!lesson) return null;

  const decision = await decideCourseAuthoring(scope, ctx, lesson.courseId);
  return decision.allowed ? lesson : null;
}

export async function setLessonPublishedAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const lessonId = String(formData.get('lessonId') ?? '');
  const isPublished = String(formData.get('isPublished') ?? '') === 'true';
  const ctx = { tenantId: viewer.tenant.id, userId: viewer.userId };

  const courseId = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const lesson = await findEditableLesson(scope, ctx, lessonId);
    if (!lesson) return null;

    await setLessonPublished(scope, lessonId, isPublished);

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: isPublished ? 'lesson.published' : 'lesson.unpublished',
      targetType: 'lesson',
      targetId: lessonId,
    });

    return lesson.courseId;
  });

  if (!courseId) return DENIED;

  revalidatePath(`/courses/${courseId}/edit`);
  revalidatePath('/catalogue', 'layout');
  revalidatePath('/courses');
  return { status: 'ok' };
}

export async function archiveLessonAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const lessonId = String(formData.get('lessonId') ?? '');
  const ctx = { tenantId: viewer.tenant.id, userId: viewer.userId };

  const courseId = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const lesson = await findEditableLesson(scope, ctx, lessonId);
    if (!lesson) return null;

    await archiveLesson(scope, lessonId);

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'lesson.archived',
      targetType: 'lesson',
      targetId: lessonId,
    });

    return lesson.courseId;
  });

  if (!courseId) return DENIED;

  revalidatePath(`/courses/${courseId}/edit`);
  revalidatePath('/catalogue', 'layout');
  revalidatePath('/courses');
  return { status: 'ok' };
}

export async function reorderLessonAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const lessonId = String(formData.get('lessonId') ?? '');
  const direction = String(formData.get('direction') ?? '') as ReorderDirection;
  const ctx = { tenantId: viewer.tenant.id, userId: viewer.userId };

  if (direction !== 'up' && direction !== 'down') {
    return { status: 'error', message: 'That is not a direction.' };
  }

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const lesson = await findEditableLesson(scope, ctx, lessonId);
    if (!lesson) return null;

    const outcome = await reorderLesson(scope, lessonId, direction);
    return { outcome, courseId: lesson.courseId };
  });

  if (!result) return DENIED;
  if (result.outcome.status === 'not_found') return DENIED;
  // Already first or last. Not an error: the button at the edge should not
  // read as broken, it has simply run out of neighbours to swap with.
  if (result.outcome.status === 'edge') return { status: 'ok' };

  revalidatePath(`/courses/${result.courseId}/edit`);
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
  revalidatePath(`/courses/${courseId}/edit`);
  revalidatePath('/catalogue', 'layout');
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
 * A presigned PUT for a document, on a course or on a lesson.
 *
 * The work is in src/lib/media/attachments.ts, which both targets share: the
 * only differences are which table the row lands in and which predicate
 * decides, and everything easy to get wrong is the same for both.
 */
export async function requestDocumentUploadAction(
  formData: FormData,
): Promise<DocumentTicket> {
  const viewer = await requireViewer();
  const target = readTarget(formData);
  if (!target) return { status: 'error', message: DENIED_MESSAGE };

  const result = await reserveAttachment(
    { tenantId: viewer.tenant.id, actorUserId: viewer.userId },
    target,
    {
      filename: String(formData.get('filename') ?? 'document.pdf'),
      contentType: String(formData.get('contentType') ?? ''),
      byteSize: Number(formData.get('byteSize') ?? 0),
      title: String(formData.get('title') ?? '').trim(),
      isPublic: String(formData.get('isPublic') ?? '') === 'true',
    },
  );

  if (result.status === 'error') return result;

  return {
    status: 'ok',
    uploadUrl: result.uploadUrl,
    resourceId: result.resourceId,
    contentType: result.contentType,
  };
}

export async function completeDocumentUploadAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const target = readTarget(formData);
  if (!target) return DENIED;

  const result = await confirmAttachment(
    { tenantId: viewer.tenant.id, actorUserId: viewer.userId },
    target,
    String(formData.get('resourceId') ?? ''),
  );

  revalidateFor(target);
  return result;
}

export async function removeAttachmentAction(
  formData: FormData,
): Promise<EditResult> {
  const viewer = await requireViewer();
  const target = readTarget(formData);
  if (!target) return DENIED;

  const result = await removeAttachment(
    { tenantId: viewer.tenant.id, actorUserId: viewer.userId },
    target,
    String(formData.get('resourceId') ?? ''),
  );

  revalidateFor(target);
  return result;
}

/** Reads which thing is being attached to, or null if the form did not say. */
function readTarget(formData: FormData): AttachmentTarget | null {
  const courseId = String(formData.get('courseId') ?? '');
  if (courseId) return { kind: 'course', id: courseId };

  const lessonId = String(formData.get('lessonId') ?? '');
  if (lessonId) return { kind: 'lesson', id: lessonId };

  return null;
}

function revalidateFor(target: AttachmentTarget): void {
  if (target.kind === 'course') {
    revalidatePath(`/teach/courses/${target.id}`);
    revalidatePath(`/courses/${target.id}/edit`);
    revalidatePath('/catalogue', 'layout');
    return;
  }
  revalidatePath(`/teach/lessons/${target.id}`);
  revalidatePath(`/lessons/${target.id}`);
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
