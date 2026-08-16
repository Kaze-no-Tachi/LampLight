import { and, asc, eq } from 'drizzle-orm';
import { courses, products, programs } from '@/db/schema';
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
    .where(and(eq(courses.tenantId, scope.tenantId), eq(products.isPublished, true)))
    .orderBy(asc(courses.title));
}

export async function findCourseBySlug(
  scope: TenantScope,
  slug: string,
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
    .where(and(eq(courses.tenantId, scope.tenantId), eq(courses.slug, slug)))
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
      and(eq(programs.tenantId, scope.tenantId), eq(products.isPublished, true)),
    )
    .orderBy(asc(programs.title));
}
