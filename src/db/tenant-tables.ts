/**
 * The authoritative list of tenant-owned tables.
 *
 * Every table here carries a tenant_id column, has row-level security enabled
 * and forced, and has a tenant_isolation policy keyed on the app.tenant_id
 * session GUC.
 *
 * This list is not documentation. It is asserted against the live database by
 * tests/isolation/rls-coverage.test.ts, which cross-checks it in both
 * directions:
 *
 *   1. Every table named here must exist, have a tenant_id column, and have
 *      RLS enabled, forced, and a policy attached.
 *   2. Every table in the database that has a tenant_id column must appear
 *      here.
 *
 * So adding a tenant-owned table and forgetting either this list or the RLS
 * migration fails CI rather than shipping a table that reads across tenants.
 */
export const TENANT_OWNED_TABLES = [
  'audit_log',
  'course_instructors',
  'courses',
  'enrollments',
  'lesson_resources',
  'lessons',
  'memberships',
  'modules',
  'orders',
  'products',
  'program_courses',
  'programs',
  'progress',
  'signup_invitations',
  'tenant_billing',
  'tenant_domains',
  'tenant_settings',
] as const;

export type TenantOwnedTable = (typeof TENANT_OWNED_TABLES)[number];

/**
 * Tables that are deliberately global and therefore carry no tenant_id and no
 * RLS policy. Listed explicitly so that the coverage test can tell "global on
 * purpose" apart from "someone forgot".
 */
export const GLOBAL_TABLES = [
  'tenants',
  'users',
  'platform_admins',
  'sessions',
  'accounts',
  'verifications',
  '__drizzle_migrations',
] as const;
