import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  courseInstructors,
  courseTagLinks,
  courseTags,
  courses,
  lessons,
  memberships,
  modules,
  products,
  programCourses,
  programs,
} from '@/db/schema';
import type { TenantScope } from '@/db/scope';
import { toSlug } from './slug';

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

  // Archived courses are excluded, matching the partial index that actually
  // enforces this (courses_tenant_id_slug_active_key, migration 0009): an
  // archived course's address is free for a new course to take.
  const [clash] = await scope.tx
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.slug, slug),
        isNull(courses.archivedAt),
      ),
    )
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
 * Retires a course. Rows survive: lessons, recordings, enrolments and every
 * student's progress stay exactly as they were, because a course is what
 * every one of those points at. What archiving actually does is take it out
 * of every list and free its slug (courses_tenant_id_slug_active_key,
 * migration 0009), so a new course may reuse the address.
 *
 * One-way on purpose, matching an archived course's own visibility rule: there
 * is no unarchive, the same way there is no path back for an archived lesson.
 * An institute that archived the wrong course makes a new one.
 */
export async function archiveCourse(
  scope: TenantScope,
  courseId: string,
): Promise<{ status: 'ok' } | { status: 'not_found' }> {
  const [archived] = await scope.tx
    .update(courses)
    .set({ archivedAt: new Date() })
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)))
    .returning({ id: courses.id });

  return archived ? { status: 'ok' } : { status: 'not_found' };
}

/**
 * How a course is sold: on its own for a price, only inside a program, or for
 * nothing at all.
 *
 * The price lives on the product, the "may somebody buy this by itself"
 * question lives on the course, and the catalogue reads both to decide what a
 * row says. They are set together here because they are one decision to the
 * person making it, and setting half of it produces states nobody meant: a
 * course that is program-only and carries a price, or a free course that is
 * not purchasable and so reads as unavailable.
 *
 * Nothing here takes a payment. Checkout is not built, and this only decides
 * what the catalogue says.
 */
export async function setCoursePricing(
  scope: TenantScope,
  courseId: string,
  input: { priceCents: number; isStandalonePurchasable: boolean },
): Promise<{ status: 'ok' } | { status: 'not_found' }> {
  const [course] = await scope.tx
    .select({ productId: courses.productId })
    .from(courses)
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)))
    .limit(1);

  if (!course) return { status: 'not_found' };

  // Whole cents, never negative, and short of the point where an integer
  // column would be the least of anybody's problems.
  const priceCents = Math.min(
    Math.max(Math.round(input.priceCents), 0),
    100_000_00,
  );

  await scope.tx
    .update(products)
    .set({ priceCents })
    .where(
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, course.productId),
      ),
    );

  await scope.tx
    .update(courses)
    .set({ isStandalonePurchasable: input.isStandalonePurchasable })
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)));

  return { status: 'ok' };
}

/** No course carries more subjects than this, and no label runs longer. */
const MAX_TAGS_PER_COURSE = 12;
const MAX_TAG_LABEL = 40;

/**
 * Replaces a course's tags, creating any the institute has not used before.
 *
 * The vocabulary is tenant-owned (see course_tags in src/db/schema/catalog.ts)
 * and has no screen of its own, so it is maintained entirely as a side effect
 * of tagging courses: a label nobody has used yet is created here, and one
 * that has just lost its last course is deleted at the end.
 *
 * DELETING THE ORPHANS IS NOT TIDINESS. The catalogue's filter chips are the
 * whole vocabulary (listCourseTags, called from the catalogue page), so a tag
 * left behind with no courses on it becomes a chip that filters the catalogue
 * down to nothing. Either the chips stop being the vocabulary or the
 * vocabulary stops holding what nothing uses, and the second is the one that
 * also keeps the "already used here" suggestions on this screen honest.
 *
 * Matched on the slug rather than the label, so "Old Testament" typed on one
 * course and "old testament" typed on another are the same tag rather than
 * two chips that look identical in the filter row.
 */
export async function setCourseTags(
  scope: TenantScope,
  courseId: string,
  labels: string[],
): Promise<{ status: 'ok' } | { status: 'not_found' }> {
  const [course] = await scope.tx
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.id, courseId)))
    .limit(1);

  if (!course) return { status: 'not_found' };

  const wanted = new Map<string, string>();
  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LABEL);
    const slug = toSlug(label);
    if (!slug || wanted.has(slug)) continue;
    if (wanted.size >= MAX_TAGS_PER_COURSE) break;
    wanted.set(slug, label);
  }

  const slugs = [...wanted.keys()];

  if (slugs.length > 0) {
    // Inserted before the lookup rather than after it, and conflicts ignored:
    // two courses being tagged with the same new subject at the same moment
    // would otherwise race on course_tags_tenant_id_slug_key and one of them
    // would fail on a label the institute plainly already wanted. Ignoring
    // the conflict also leaves an existing label alone, which is right:
    // renaming the vocabulary is a different act from using it.
    await scope.tx
      .insert(courseTags)
      .values(
        slugs.map((slug) => ({
          tenantId: scope.tenantId,
          slug,
          label: wanted.get(slug) ?? slug,
        })),
      )
      .onConflictDoNothing();
  }

  const vocabulary =
    slugs.length > 0
      ? await scope.tx
          .select({ id: courseTags.id, slug: courseTags.slug })
          .from(courseTags)
          .where(
            and(
              eq(courseTags.tenantId, scope.tenantId),
              inArray(courseTags.slug, slugs),
            ),
          )
      : [];

  const tagIds = vocabulary.map((row) => row.id);

  await scope.tx
    .delete(courseTagLinks)
    .where(
      and(
        eq(courseTagLinks.tenantId, scope.tenantId),
        eq(courseTagLinks.courseId, courseId),
        ...(tagIds.length > 0
          ? [notInArray(courseTagLinks.tagId, tagIds)]
          : []),
      ),
    );

  if (tagIds.length > 0) {
    await scope.tx
      .insert(courseTagLinks)
      .values(
        tagIds.map((tagId) => ({
          tenantId: scope.tenantId,
          courseId,
          tagId,
        })),
      )
      .onConflictDoNothing();
  }

  // Scoped to this tenant like everything else, so one institute abandoning a
  // subject cannot reach another institute's identically named one.
  await scope.tx.delete(courseTags).where(
    and(
      eq(courseTags.tenantId, scope.tenantId),
      sql`not exists (
        select 1 from course_tag_links l
        where l.tenant_id = ${courseTags.tenantId} and l.tag_id = ${courseTags.id}
      )`,
    ),
  );

  return { status: 'ok' };
}

/**
 * Which section the new lesson goes into: the one that was named, a new one,
 * or the course's first.
 *
 * Every branch filters on both the tenant and the course, so a section id
 * belonging to another course resolves to nothing rather than to somebody
 * else's syllabus.
 */
export async function resolveModule(
  scope: TenantScope,
  courseId: string,
  asked: { askedModuleId: string; newModule: string },
): Promise<string | null> {
  if (asked.newModule) {
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

    const [made] = await scope.tx
      .insert(modules)
      .values({
        tenantId: scope.tenantId,
        courseId,
        title: asked.newModule,
        sortOrder: next[0]?.next ?? 0,
      })
      .returning({ id: modules.id });

    return made?.id ?? null;
  }

  if (asked.askedModuleId) {
    const [named] = await scope.tx
      .select({ id: modules.id })
      .from(modules)
      .where(
        and(
          eq(modules.tenantId, scope.tenantId),
          eq(modules.courseId, courseId),
          eq(modules.id, asked.askedModuleId),
        ),
      )
      .limit(1);

    // A section that is not this course's is not a fallback case: somebody
    // sent an id the screen never offered, and quietly filing the lesson
    // somewhere else is worse than refusing.
    return named?.id ?? null;
  }

  const [first] = await scope.tx
    .select({ id: modules.id })
    .from(modules)
    .where(
      and(eq(modules.tenantId, scope.tenantId), eq(modules.courseId, courseId)),
    )
    .orderBy(modules.sortOrder)
    .limit(1);

  if (first) return first.id;

  const [made] = await scope.tx
    .insert(modules)
    .values({
      tenantId: scope.tenantId,
      courseId,
      title: 'Lessons',
      sortOrder: 0,
    })
    .returning({ id: modules.id });

  return made?.id ?? null;
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

/**
 * Publishes or withdraws one lesson, distinct from `is_free_preview`
 * (round 2, chunk 3). A lesson can be published while still gated by the
 * access predicate exactly as a free-preview one can be unpublished while
 * open to nobody but its author: publication is "is this finished", the
 * predicate is "who may hear it".
 */
export async function setLessonPublished(
  scope: TenantScope,
  lessonId: string,
  isPublished: boolean,
): Promise<{ status: 'ok' } | { status: 'not_found' }> {
  const [updated] = await scope.tx
    .update(lessons)
    .set({ isPublished })
    .where(and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, lessonId)))
    .returning({ id: lessons.id });

  return updated ? { status: 'ok' } : { status: 'not_found' };
}

/**
 * Retires a lesson. The row and its progress survive; archived_at is what
 * every read filters on, the same rule an archived course gets, so this is
 * hidden from its own author too, not only from students. One-way, matching
 * the course: an institute that archived the wrong lesson makes a new one.
 */
export async function archiveLesson(
  scope: TenantScope,
  lessonId: string,
): Promise<{ status: 'ok' } | { status: 'not_found' }> {
  const [archived] = await scope.tx
    .update(lessons)
    .set({ archivedAt: new Date() })
    .where(and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, lessonId)))
    .returning({ id: lessons.id });

  return archived ? { status: 'ok' } : { status: 'not_found' };
}

export type ReorderDirection = 'up' | 'down';
export type ReorderResult = { status: 'ok' | 'not_found' | 'edge' };

/**
 * Moves a lesson one place earlier or later among its own module's lessons,
 * by swapping sort_order with whichever neighbour currently sits there.
 * Rewrites the affected pair only, not the whole list: a course with three
 * hundred lessons does not need three hundred rows touched to move one.
 *
 * Archived lessons are invisible to the search for a neighbour. Otherwise
 * moving past one would shift a lesson two places in what anybody still sees
 * while the button said one, and the gap in sort_order an archive leaves
 * behind never needs closing: nothing reads sort_order as a position, only as
 * an order.
 */
export async function reorderLesson(
  scope: TenantScope,
  lessonId: string,
  direction: ReorderDirection,
): Promise<ReorderResult> {
  const [lesson] = await scope.tx
    .select({ moduleId: lessons.moduleId, sortOrder: lessons.sortOrder })
    .from(lessons)
    .where(
      and(
        eq(lessons.tenantId, scope.tenantId),
        eq(lessons.id, lessonId),
        isNull(lessons.archivedAt),
      ),
    )
    .limit(1);

  if (!lesson) return { status: 'not_found' };

  const [neighbour] = await scope.tx
    .select({ id: lessons.id, sortOrder: lessons.sortOrder })
    .from(lessons)
    .where(
      and(
        eq(lessons.tenantId, scope.tenantId),
        eq(lessons.moduleId, lesson.moduleId),
        isNull(lessons.archivedAt),
        direction === 'up'
          ? lt(lessons.sortOrder, lesson.sortOrder)
          : gt(lessons.sortOrder, lesson.sortOrder),
      ),
    )
    .orderBy(
      direction === 'up' ? desc(lessons.sortOrder) : asc(lessons.sortOrder),
    )
    .limit(1);

  if (!neighbour) return { status: 'edge' };

  await scope.tx
    .update(lessons)
    .set({ sortOrder: neighbour.sortOrder })
    .where(and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, lessonId)));

  await scope.tx
    .update(lessons)
    .set({ sortOrder: lesson.sortOrder })
    .where(
      and(eq(lessons.tenantId, scope.tenantId), eq(lessons.id, neighbour.id)),
    );

  return { status: 'ok' };
}
