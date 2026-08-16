import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantDb } from '@/db/client';
import { findMembership } from '@/db/repositories/entitlements';
import { requireTenant } from '@/lib/tenancy/context';
import type { TenantContext } from '@/lib/tenancy/resolve';
import { getAuth } from './index';

/**
 * Authorization. This is where identity and tenancy meet, and the shape of it
 * is the whole point of the product's isolation model.
 *
 * A session proves who someone is, platform-wide. It says nothing about which
 * institute they may see. Access is always the conjunction:
 *
 *     the tenant resolved from the Host header
 *   + a membership row for this user in THAT tenant
 *
 * So a person who holds accounts at two institutes, signed in at one, has no
 * standing at the other. The session is real, the membership is missing, and
 * the answer is the same 404 an unknown person gets.
 */

export type Viewer = {
  readonly userId: string;
  readonly email: string;
  readonly tenant: TenantContext;
  readonly role: 'student' | 'instructor' | 'admin';
};

export type MembershipRole = Viewer['role'];

/** The signed-in user, platform-wide, with no tenant claim implied. */
export async function getSessionUser(): Promise<{
  id: string;
  email: string;
} | null> {
  const session = await getAuth().api.getSession({
    headers: await headers(),
  });

  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email };
}

/**
 * Resolves the viewer for this request: the tenant, plus this user's role in
 * it. Null when there is no session, or when there is one but the user has no
 * membership in the tenant whose domain they are on.
 */
export async function getViewer(): Promise<Viewer | null> {
  const tenant = await requireTenant();
  const user = await getSessionUser();
  if (!user) return null;

  const membership = await getTenantDb(tenant.id).run((scope) =>
    findMembership(scope, user.id),
  );
  if (!membership) return null;

  return {
    userId: user.id,
    email: user.email,
    tenant,
    role: membership.role,
  };
}

/**
 * Requires a membership in the tenant this request arrived on.
 *
 * Denial is notFound rather than a redirect to sign-in or a 403. A 403 would
 * confirm that the resource exists and that this person is simply not allowed,
 * which is exactly the distinction PRD section 7 says must not be observable.
 * Sign-in prompts belong on pages that are meant to be public, not on gated
 * ones.
 */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) notFound();
  return viewer;
}

const RANK: Record<MembershipRole, number> = {
  student: 0,
  instructor: 1,
  admin: 2,
};

/**
 * Requires at least the given role within the current tenant.
 *
 * Roles are ranked rather than compared for equality, so an admin satisfies an
 * instructor requirement. An institute admin being locked out of their own
 * instructors' pages would be a bug, not a security property.
 */
export async function requireRole(minimum: MembershipRole): Promise<Viewer> {
  const viewer = await requireViewer();
  if (RANK[viewer.role] < RANK[minimum]) notFound();
  return viewer;
}
