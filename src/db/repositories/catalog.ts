import { and, asc, eq, isNull } from 'drizzle-orm';
import { courseResources, courses, products, programs } from '@/db/schema';
import type { TenantScope } from '@/db/scope';

/**
 * Example repository, catalog reads.
 *
 * The pattern every repository follows:
 *
 *   1. TenantScope is the first parameter, always.
 *   2. Every query filters on scope.tenantId explicitly, even though RLS would
 *      also filter it. That redundancy is the point: it is the application
 *      layer of the two-layer defence, and the isolation suite runs these
 *      functions with RLS bypassed specifically to prove this filter carries
 *      its own weight.
 *   3. A miss returns null or an empty array. Repositories never throw a
 *      "wrong tenant" error, because callers must not be able to tell a wrong
 *      tenant from a nonexistent row (PRD section 7).
 */

export type CatalogCourse = {
  id: string;
  title: string;
  slug: string;
  descriptionMd: string | null;
  isStandalonePurchasable: boolean;
  priceCents: number;
  currency: string;
};

export async function listPublishedCourses(
  scope: TenantScope,
): Promise<CatalogCourse[]> {
  return scope.tx
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      descriptionMd: courses.descriptionMd,
      isStandalonePurchasable: courses.isStandalonePurchasable,
      priceCents: products.priceCents,
      currency: products.currency,
    })
    .from(courses)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, courses.productId),
      ),
    )
    .where(
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(products.isPublished, true),
        isNull(courses.archivedAt),
      ),
    )
    .orderBy(asc(courses.title));
}

/**
 * One course by its address, for the public course page.
 *
 * THE LEAK THIS CLOSES. This used to filter on tenant and slug and nothing
 * else, while the list query beside it filtered on published. So an
 * unpublished course was not in the catalogue and was still reachable by
 * typing its address: title, description, and every public course document
 * rendered. Only the audio was protected, because that goes through the access
 * predicate rather than through here. The page's own comment claimed an
 * unpublished course was "not found", and it was not.
 *
 * The test that should have caught it checked the course was absent from the
 * catalogue list and never tried the URL.
 *
 * `includeUnpublished` exists for the editor, which has to show an author
 * their own draft, and every caller that passes it has already established the
 * viewer may author the course.
 */
export async function findCourseBySlug(
  scope: TenantScope,
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<CatalogCourse | null> {
  const rows = await scope.tx
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      descriptionMd: courses.descriptionMd,
      isStandalonePurchasable: courses.isStandalonePurchasable,
      priceCents: products.priceCents,
      currency: products.currency,
    })
    .from(courses)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, courses.productId),
      ),
    )
    .where(
      and(
        eq(courses.tenantId, scope.tenantId),
        eq(courses.slug, slug),
        // Archived is hidden from everybody, authors included: retiring a
        // course should take it off the author's list too, not just the
        // students'.
        isNull(courses.archivedAt),
        ...(options.includeUnpublished ? [] : [eq(products.isPublished, true)]),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export type CatalogProgram = {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
};

export async function listPublishedPrograms(
  scope: TenantScope,
): Promise<CatalogProgram[]> {
  return scope.tx
    .select({
      id: programs.id,
      title: programs.title,
      slug: programs.slug,
      priceCents: products.priceCents,
    })
    .from(programs)
    .innerJoin(
      products,
      and(
        eq(products.tenantId, scope.tenantId),
        eq(products.id, programs.productId),
      ),
    )
    .where(
      and(
        eq(programs.tenantId, scope.tenantId),
        eq(products.isPublished, true),
      ),
    )
    .orderBy(asc(programs.title));
}

export type CourseResource = {
  id: string;
  kind: 'audio' | 'video' | 'pdf' | 'link';
  title: string;
  storageKey: string | null;
  url: string | null;
  filename: string | null;
  /** Null while an upload is reserved and unconfirmed. Links carry zero. */
  byteSize: number | null;
  isPublic: boolean;
};

/**
 * Documents attached to a course: the syllabus, a reading list, a handout.
 *
 * Returns every resource regardless of `is_public`, because the caller knows
 * whether the viewer is enrolled and this repository does not. Deciding that
 * here would put a second authority next to the access predicate.
 */
export async function listCourseResources(
  scope: TenantScope,
  courseId: string,
): Promise<CourseResource[]> {
  return scope.tx
    .select({
      id: courseResources.id,
      kind: courseResources.kind,
      title: courseResources.title,
      storageKey: courseResources.storageKey,
      url: courseResources.url,
      filename: courseResources.filename,
      byteSize: courseResources.byteSize,
      isPublic: courseResources.isPublic,
    })
    .from(courseResources)
    .where(
      and(
        eq(courseResources.tenantId, scope.tenantId),
        eq(courseResources.courseId, courseId),
      ),
    )
    .orderBy(asc(courseResources.sortOrder));
}
