'use server';

import { revalidatePath } from 'next/cache';
import { getTenantDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { requireRole } from '@/lib/auth/guards';
import {
  archiveCourse,
  assignInstructor,
  createCourse,
  createProgram,
  removeInstructor,
  setCoursePricing,
  setCoursePublished,
  setCourseTags,
  setProgramPublished,
  setProgramCourses,
} from '@/lib/catalog/authoring';

/**
 * Catalogue authoring, admin only. Moved here from
 * settings/catalog/actions.ts (round 2, chunk 5): deciding a course or
 * program exists, who teaches it, and whether students can see it now lives
 * on /teach alongside everything else staff does, rather than under a
 * separate settings page nobody but an admin ever had reason to visit.
 *
 * Every one of these is a public endpoint that happens to be called from a
 * page, so the tenant comes from requireRole, which reads the resolved Host
 * header, and never from the form. An id in the payload is only ever used
 * inside that scope, so naming another institute's course finds nothing.
 */

export type CatalogResult =
  { status: 'ok'; message?: string } | { status: 'error'; message: string };

export type CreateCourseResult =
  { status: 'ok'; courseId: string } | { status: 'error'; message: string };

/**
 * Creates a course and returns its id rather than a message: the caller
 * navigates straight to the editor, per the round 2 decision that creating a
 * course lands there rather than back on this list.
 */
export async function createCourseAction(
  formData: FormData,
): Promise<CreateCourseResult> {
  const viewer = await requireRole('admin');

  const tags = formData.getAll('tags').map(String);
  const instructorId = String(formData.get('instructorId') ?? '');
  const pricing = readPricing(formData);

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const created = await createCourse(scope, {
      title: String(formData.get('title') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      descriptionMd: String(formData.get('description') ?? ''),
    });

    if (created.status !== 'ok') return created;

    // Everything the new-course screen collects, applied in the one
    // transaction that created the course. The alternative, a create followed
    // by three separate actions from the browser, leaves a course half set up
    // whenever one of them fails or the tab is closed between them, and the
    // half that is missing is the half a visitor would have read.
    await setCourseTags(scope, created.id, tags);
    if (pricing) await setCoursePricing(scope, created.id, pricing);
    if (instructorId) {
      await assignInstructor(scope, created.id, instructorId);
    }

    await scope.tx.insert(auditLog).values({
      tenantId: scope.tenantId,
      actorUserId: viewer.userId,
      action: 'catalog.course_created',
      targetType: 'course',
      targetId: created.id,
    });

    return created;
  });

  if (result.status === 'error') return result;

  revalidatePath('/teach');
  return { status: 'ok', courseId: result.id };
}

/**
 * "How it is sold", as three choices rather than two fields.
 *
 * The screen offers Sold on its own, Program only, and Free, because that is
 * how the decision is actually made. Underneath it is a price and a
 * purchasable flag, and this is where one turns into the other, so that no
 * caller has to remember that "free" also means purchasable or that
 * "program only" ignores whatever is in the price box.
 *
 * Returns null when the form carried no pricing at all, which is what an
 * instructor's save looks like: the block is admin-only, so it is simply
 * absent rather than sent empty.
 */
function readPricing(
  formData: FormData,
): { priceCents: number; isStandalonePurchasable: boolean } | null {
  const sold = String(formData.get('sold') ?? '');
  if (sold === '') return null;

  if (sold === 'program') {
    return { priceCents: 0, isStandalonePurchasable: false };
  }
  if (sold === 'free') {
    return { priceCents: 0, isStandalonePurchasable: true };
  }

  // Dollars in the box, cents in the column. A price that will not parse is
  // taken as nothing rather than refused: the field is a number input and the
  // states that reach here are an empty box and a stray character.
  const dollars = Number.parseFloat(String(formData.get('price') ?? ''));
  const priceCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
  return { priceCents, isStandalonePurchasable: true };
}

/**
 * Changing what an existing course costs. Admin only, the same as publishing:
 * an assigned instructor writes the course, the institute decides what it is
 * worth.
 */
export async function setCoursePricingAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');
  const courseId = String(formData.get('courseId') ?? '');
  const pricing = readPricing(formData);

  if (!pricing) return { status: 'error', message: 'Nothing to change.' };

  const done = await getTenantDb(viewer.tenant.id).run((scope) =>
    setCoursePricing(scope, courseId, pricing),
  );

  if (done.status === 'not_found') {
    return { status: 'error', message: 'That course no longer exists.' };
  }

  revalidatePath('/teach');
  revalidatePath(`/teach/courses/${courseId}`);
  revalidatePath('/catalogue', 'layout');
  return { status: 'ok' };
}

/**
 * Retires a course. Admin only, narrower than course:edit, the same as
 * publish: whether the course still exists is not an assigned instructor's
 * call even though editing its content is.
 */
export async function archiveCourseAction(
  formData: FormData,
): Promise<CatalogResult> {
  const viewer = await requireRole('admin');
  const courseId = String(formData.get('courseId') ?? '');

  const result = await getTenantDb(viewer.tenant.id).run(async (scope) => {
    const done = await archiveCourse(scope, courseId);

    if (done.status === 'ok') {
      await scope.tx.insert(auditLog).values({
        tenantId: scope.tenantId,
        actorUserId: viewer.userId,
        action: 'catalog.course_archived',
        targetType: 'course',
        targetId: courseId,
      });
    }

    return done;
  });

  if (result.status === 'not_found') {
    return { status: 'error', message: 'That course no longer exists.' };
  }

  revalidatePath('/teach');
  revalidatePath('/courses', 'layout');
  revalidatePath('/catalogue', 'layout');
  return { status: 'ok', message: 'Archived.' };
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

  revalidatePath('/teach');
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

  revalidatePath('/teach');
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

  revalidatePath('/teach');
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

  revalidatePath('/teach');
  return { status: 'ok', message: 'Saved.' };
}
