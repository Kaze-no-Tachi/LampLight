import { pgEnum } from 'drizzle-orm/pg-core';

export const tenantStatus = pgEnum('tenant_status', [
  'pending',
  'active',
  'suspended',
]);

/**
 * Mirrors the Cloudflare for SaaS custom hostname lifecycle (PRD section 5.3).
 * Only 'active' domains resolve to a tenant.
 */
export const domainVerificationStatus = pgEnum('domain_verification_status', [
  'pending',
  'verifying',
  'active',
  'failed',
]);

export const membershipRole = pgEnum('membership_role', [
  'student',
  'instructor',
  'admin',
]);

export const productKind = pgEnum('product_kind', ['program', 'course']);

export const lessonResourceKind = pgEnum('lesson_resource_kind', [
  'audio',
  'video',
  'pdf',
  'link',
]);

/**
 * What an entitlement was granted against. A 'program' enrollment transitively
 * entitles every course in that program.
 */
export const enrollmentSourceKind = pgEnum('enrollment_source_kind', [
  'program',
  'course',
]);

/**
 * The PRD does not enumerate order states. These track the Stripe Checkout
 * lifecycle we actually act on: a session is created (pending), the webhook
 * confirms payment (paid), payment fails or the session expires (failed), or
 * the charge is refunded and the entitlement is revoked (refunded).
 */
export const orderStatus = pgEnum('order_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
]);
