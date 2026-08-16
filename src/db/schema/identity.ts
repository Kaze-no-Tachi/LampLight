import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { membershipRole } from './enums';
import { tenants } from './tenancy';

/**
 * Global identity (PRD section 5.4). One row per human across the whole
 * platform. This table is deliberately NOT tenant-scoped and therefore has no
 * RLS policy.
 *
 * Consequence worth stating plainly: any query that reaches `users` without
 * joining through `memberships` can see people who belong to other tenants.
 * Repositories must always reach users via memberships, which is why the
 * example repositories join rather than select from users directly.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The join that carries the role. One email can be a student at Tenant A and
 * an admin at Tenant B.
 *
 * The unique on (tenant_id, user_id) is load-bearing: it is the foreign key
 * target that lets course_instructors, enrollments, orders, and progress
 * prove their user is a member of the same tenant as the row itself.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull().default('student'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('memberships_tenant_id_id_key').on(table.tenantId, table.id),
    unique('memberships_tenant_id_user_id_key').on(table.tenantId, table.userId),
  ],
);

/**
 * Platform operators. Superadmin actions run through the RLS-bypassing role
 * and always write an audit_log row (PRD section 5.1).
 */
export const platformAdmins = pgTable('platform_admins', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
