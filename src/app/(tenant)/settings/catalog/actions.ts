'use server';

import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import {
  assignInstructor,
  createCourse,
  createProgram,
  removeInstructor,
  setCoursePublished,
  setProgramPublished,
  setProgramCourses,
} from '@/lib/catalog/authoring';

/**
 * Catalogue authoring, admin only.
 *
 * Every one of these is a public endpoint that happens to be called from a
 * page, so the tenant comes from requireRole, which reads the resolved Host
 * header, and never from the form. An id in the payload is only ever used
 * inside that scope, so naming another institute's course finds nothing.
 */

export type CatalogResult =
  { status: 'ok'; message?: string } | { status: 'error'; message: string };

export async function createCourseAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const created = await createCourse(scope, {
      title: String(formData.get('title') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      descriptionMd: String(formData.get('description') ?? ''),
    });

    if (created.status === 'ok') {
      await scope.tx.insert(auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: viewer.userId,
        action: 'catalog.course_created',
        targetType: 'course',
        targetId: created.id,
      });
    }

    return created;
  });

  if (result.status === 'error') return result;

  revalidatePath('/settings/catalog');
  revalidatePath('/teach');
  return { status: 'ok', message: 'Course created. It is not published yet.' };
}

export async function createProgramAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const created = await createProgram(scope, {
      title: String(formData.get('title') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      descriptionMd: String(formData.get('description') ?? ''),
    });

    if (created.status === 'ok') {
      await scope.tx.insert(auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: viewer.userId,
        action: 'catalog.program_created',
        targetType: 'program',
        targetId: created.id,
      });
    }

    return created;
  });

  if (result.status === 'error') return result;

  revalidatePath('/settings/catalog');
  return { status: 'ok', message: 'Program created. It is not published yet.' };
}

export async function setPublishedAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');
  const courseId = String(formData.get('courseId') ?? '');
  const publish = String(formData.get('publish') ?? '') === 'true';

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const done = await setCoursePublished(scope, courseId, publish);

    if (done.status === 'ok') {
      // Publishing changes who can see a thing, which is the category of
      // change worth being able to point at later.
      await scope.tx.insert(auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: viewer.userId,
        action: publish ? 'catalog.published' : 'catalog.unpublished',
        targetType: 'course',
        targetId: courseId,
      });
    }

    return done;
  });

  if (result.status === 'not_found') {
    return { status: 'error', message: 'That course no longer exists.' };
  }

  revalidatePath('/settings/catalog');
  revalidatePath('/catalogue', 'layout');
  return {
    status: 'ok',
    message: publish ? 'Published.' : 'Withdrawn from the catalogue.',
  };
}

export async function setProgramPublishedAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');
  const programId = String(formData.get('programId') ?? '');
  const publish = String(formData.get('publish') ?? '') === 'true';

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const done = await setProgramPublished(scope, programId, publish);

    if (done.status === 'ok') {
      await scope.tx.insert(auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: viewer.userId,
        action: publish ? 'catalog.published' : 'catalog.unpublished',
        targetType: 'program',
        targetId: programId,
      });
    }

    return done;
  });

  if (result.status === 'not_found') {
    return { status: 'error', message: 'That program no longer exists.' };
  }

  revalidatePath('/settings/catalog');
  revalidatePath('/catalogue', 'layout');
  return {
    status: 'ok',
    message: publish ? 'Published.' : 'Withdrawn from the catalogue.',
  };
}

export async function assignInstructorAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');
  const courseId = String(formData.get('courseId') ?? '');
  const userId = String(formData.get('userId') ?? '');

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const done = await assignInstructor(scope, courseId, userId);

    if (done.status === 'ok') {
      await scope.tx.insert(auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: viewer.userId,
        action: 'catalog.instructor_assigned',
        targetType: 'course',
        targetId: courseId,
      });
    }

    return done;
  });

  switch (result.status) {
    case 'not_found':
      return { status: 'error', message: 'That course or person is gone.' };
    case 'not_staff':
      return {
        status: 'error',
        message:
          'Only staff can be put in front of a course. Change their role on ' +
          'the People page first.',
      };
    case 'already':
      return { status: 'ok', message: 'They were already assigned.' };
    default:
      revalidatePath('/settings/catalog');
      revalidatePath('/teach');
      return { status: 'ok', message: 'Assigned.' };
  }
}

export async function removeInstructorAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');
  const courseId = String(formData.get('courseId') ?? '');
  const userId = String(formData.get('userId') ?? '');

  await getTenantDb(viewer.tenant.id).run(async (scope) => {
    await removeInstructor(scope, courseId, userId);
    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'catalog.instructor_removed',
      targetType: 'course',
      targetId: courseId,
    });
  });

  revalidatePath('/settings/catalog');
  revalidatePath('/teach');
  return { status: 'ok', message: 'Removed.' };
}

export async function setProgramCoursesAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');
  const programId = String(formData.get('programId') ?? '');
  const courseIds = formData.getAll('courseId').map(String).filter(Boolean);

  const result = await getTenantDb(viewer.tenant.id).run((scope) =>
    setProgramCourses(scope, programId, courseIds),
  );

  if (result.status === 'not_found') {
    return { status: 'error', message: 'That program no longer exists.' };
  }

  revalidatePath('/settings/catalog');
  return { status: 'ok', message: 'Saved.' };
}
