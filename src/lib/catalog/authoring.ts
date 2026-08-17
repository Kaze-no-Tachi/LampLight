import { and, eq, inArray } from 'drizzle-orm';
import {
  courseInstructors,
  courses,
  memberships,
  modules,
  products,
  programCourses,
  programs,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Creating the things an institute teaches.
 *
 * WHY THIS EXISTS
 *
 * Everything downstream of a course could be edited and none of it could be
 * created. Modules and lessons had actions, uploads had actions, enrolment had
 * a screen, and the courses themselves existed only in the seed script. A real
 * institute therefore arrived at an empty `/teach` that told them an admin
 * could assign them to a course, with no course to assign and no way to make
 * one. Found by provisioning a real institute and trying to use it.
 *
 * WHAT A COURSE ACTUALLY IS HERE
 *
 * A course is two rows. `products` carries what it costs and whether it is
 * published, `courses` carries what it is called and what it teaches, and the
 * foreign key is NOT NULL, so a course cannot exist without its product. That
 * is a payments concept leaking into authoring, but the alternative is a
 * nullable product and a second way for a course to be in a broken state.
 * Price stays at zero until somebody sets one, which is what the column
 * already defaults to.
 *
 * Every function here takes a TenantScope and writes only inside it, so the
 * tenant is the one resolved from the Host header rather than anything a form
 * could name.
 */

export type AuthoringResult =
  { status: 'ok'; id: string } | { status: 'error'; message: string };

/** Lowercase, hyphenated, and nothing that would need escaping in a URL. */
export function toSlug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function checkTitleAndSlug(
  title: string,
  slug: string,
): { status: 'error'; message: string } | null {
  if (title.trim().length < 2) {
    return { status: 'error', message: 'Give it a title.' };
  }
  if (!slug) {
    return {
      status: 'error',
      message:
        'That title produces an empty web address. Add some letters or ' +
        'numbers, or set the address yourself.',
    };
  }
  return null;
}

/**
 * Creates a course and the product it cannot exist without.
 *
 * Unpublished by default. An institute building its catalogue is mid-thought,
 * and a half-written course appearing to students the moment it is named is
 * the wrong default even though it is the convenient one.
 */
export async function createCourse(
  scope: TenantScope,
  input: { title: string; slug?: string; descriptionMd?: string },
): Promise<AuthoringResult> {
  const title = input.title.trim();
  const slug = toSlug(input.slug?.trim() || title);

  const invalid = checkTitleAndSlug(title, slug);
  if (invalid) return invalid;

  const [clash] = await scope.tx
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.slug, slug)))
    .limit(1);

  if (clash) {
    return {
      status: 'error',
      message: `Another course already uses the address "${slug}".`,
    };
  }

  const [product] = await scope.tx
    .insert(products)
    .values({ tenantId: scope.tenantId, kind: 'course', isPublished: false })
    .returning({ id: products.id });

  if (!product) return { status: 'error', message: 'Could not create it.' };

  const [created] = await scope.tx
    .insert(courses)
    .values({
      tenantId: scope.tenantId,
      productId: product.id,
      title,
      slug,
      descriptionMd: input.descriptionMd?.trim() || null,
    })
    .returning({ id: courses.id });

  if (!created) return { status: 'error', message: 'Could not create it.' };

  // A course starts with one section, and nobody is ever shown it.
  //
  // lessons.module_id is NOT NULL, so a lesson cannot exist without a module.
  // That is a real constraint and making it nullable would put "which lessons
  // have no section" into every query that touches them. But an institute
  // adding its first course does not want to think about sections, so one is
  // created here and the editor hides it while it is the only one. Somebody
  // who genuinely wants to group lessons adds a second, and both appear.
  await scope.tx.insert(modules).values({
    tenantId: scope.tenantId,
    courseId: created.id,
    title: 'Lessons',
    sortOrder: 0,
  });

  return { status: 'ok', id: created.id };
}

/** Same shape for a program, which groups courses and is sold as one thing. */
export async function createProgram(
  scope: TenantScope,
  input: { title: string; slug?: string; descriptionMd?: string },
): Promise<AuthoringResult> {
  const title = input.title.trim();
  const slug = toSlug(input.slug?.trim() || title);

  const invalid = checkTitleAndSlug(title, slug);
  if (invalid) return invalid;

  const [clash] = await scope.tx
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.tenantId, scope.tenantId), eq(programs.slug, slug)))
    .limit(1);

  if (clash) {
    return {
      status: 'error',
      message: `Another program already uses the address "${slug}".`,
    };
  }

  const [product] = await scope.tx
    .insert(products)
    .values({ tenantId: scope.tenantId, kind: 'program', isPublished: false })
    .returning({ id: products.id });

  if (!product) return { status: 'error', message: 'Could not create it.' };

  const [created] = await scope.tx
    .insert(programs)
    .values({
      tenantId: scope.tenantId,
      productId: product.id,
      title,
      slug,
      descriptionMd: input.descriptionMd?.trim() || null,
    })
    .returning({ id: programs.id });

  if (!created) return { status: 'error', message: 'Could not create it.' };
  return { status: 'ok', id: created.id };
}

/**
 * Publishes or withdraws a course.
 *
 * The flag lives on the product rather than the course, so this joins rather
 * than trusting an id from a form: an id that belongs to another institute
 * finds no row inside this scope and changes nothing.
 */
export async function setCoursePublished(
  scope: TenantScope,
  courseId: string,
  isPublished: boolean,
): Promise<{ status: 'ok' } | { status: 'not_found' }> {
  const [course] = await scope.tx
    .select({ productId: courses.productId })
    .from(courses)
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)))
    .limit(1);

  if (!course) return { status: 'not_found' };

  await scope.tx
    .update(products)
    .set({ isPublished })
    .where(
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, course.productId),
      ),
    );

  return { status: 'ok' };
}

/**
 * Publishes or withdraws a program.
 *
 * The same shape as a course, and it existed as an omission rather than a
 * decision: the catalogue screen shipped with a publish button for courses and
 * none for programs, so a program could be created and could never be seen. The
 * public list filters on published, which made a new program invisible with no
 * error and nothing to click.
 */
export async function setProgramPublished(
  scope: TenantScope,
  programId: string,
  isPublished: boolean,
): Promise<{ status: 'ok' } | { status: 'not_found' }> {
  const [program] = await scope.tx
    .select({ productId: programs.productId })
    .from(programs)
    .where(
      and(eq(programs.tenantId, scope.tenantId), eq(programs.id, programId)),
    )
    .limit(1);

  if (!program) return { status: 'not_found' };

  await scope.tx
    .update(products)
    .set({ isPublished })
    .where(
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, program.productId),
      ),
    );

  return { status: 'ok' };
}

/**
 * Puts somebody in front of a course, or takes them away from it.
 *
 * THE CHECK THAT MATTERS. The person has to hold a staff membership at this
 * institute. Without it an admin could assign a student, or somebody from
 * another institute, and assignment is what the authoring predicate reads to
 * decide who may edit a course. This is the door, so it checks standing rather
 * than assuming the form only offered valid choices.
 */
export async function assignInstructor(
  scope: TenantScope,
  courseId: string,
  userId: string,
): Promise<{ status: 'ok' | 'not_found' | 'not_staff' | 'already' }> {
  const [course] = await scope.tx
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)))
    .limit(1);

  if (!course) return { status: 'not_found' };

  const [member] = await scope.tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, scope.tenantId),
        eq(memberships.userId, userId),
      ),
    )
    .limit(1);

  if (!member) return { status: 'not_found' };
  if (member.role === 'student') return { status: 'not_staff' };

  const [existing] = await scope.tx
    .select({ userId: courseInstructors.userId })
    .from(courseInstructors)
    .where(
      and(
        eq(courseInstructors.tenantId, scope.tenantId),
        eq(courseInstructors.courseId, courseId),
        eq(courseInstructors.userId, userId),
      ),
    )
    .limit(1);

  if (existing) return { status: 'already' };

  await scope.tx
    .insert(courseInstructors)
    .values({ tenantId: scope.tenantId, courseId, userId });

  return { status: 'ok' };
}

export async function removeInstructor(
  scope: TenantScope,
  courseId: string,
  userId: string,
): Promise<{ status: 'ok' }> {
  await scope.tx
    .delete(courseInstructors)
    .where(
      and(
        eq(courseInstructors.tenantId, scope.tenantId),
        eq(courseInstructors.courseId, courseId),
        eq(courseInstructors.userId, userId),
      ),
    );

  return { status: 'ok' };
}

/**
 * Replaces a program's course list with exactly the ids given.
 *
 * Replace rather than add-and-remove, because the form is a set of checkboxes
 * and that is what the person editing it believes they are submitting. Ids
 * that do not belong to this institute are dropped rather than refused: the
 * checkboxes were rendered from this institute's courses, so anything else in
 * the payload was put there by somebody poking at the endpoint.
 */
export async function setProgramCourses(
  scope: TenantScope,
  programId: string,
  courseIds: string[],
): Promise<{ status: 'ok' | 'not_found' }> {
  const [program] = await scope.tx
    .select({ id: programs.id })
    .from(programs)
    .where(
      and(eq(programs.tenantId, scope.tenantId), eq(programs.id, programId)),
    )
    .limit(1);

  if (!program) return { status: 'not_found' };

  const mine = courseIds.length
    ? await scope.tx
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.tenantId, scope.tenantId),
            inArray(courses.id, courseIds),
          ),
        )
    : [];

  await scope.tx
    .delete(programCourses)
    .where(
      and(
        eq(programCourses.tenantId, scope.tenantId),
        eq(programCourses.programId, programId),
      ),
    );

  if (mine.length > 0) {
    await scope.tx.insert(programCourses).values(
      mine.map((course, index) => ({
        tenantId: scope.tenantId,
        programId,
        courseId: course.id,
        sortOrder: index,
      })),
    );
  }

  return { status: 'ok' };
}
