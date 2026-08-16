import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
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
  // Better Auth treats name as required, so it is not null with an empty
  // default rather than nullable. Signup always supplies one.
  name: text('name').notNull().default(''),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
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
    unique('memberships_tenant_id_user_id_key').on(
      table.tenantId,
      table.userId,
    ),
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

/**
 * Better Auth's own tables (PRD section 5.4).
 *
 * Global, like `users`, and for the same reason: identity is platform-wide and
 * membership is what scopes it to an institute. None of these carry a
 * tenant_id and none have an RLS policy, so they are listed in GLOBAL_TABLES.
 *
 * THE POINT THAT MATTERS: a session is authentication, not authorization.
 *
 * Holding a valid session proves who someone is. It proves nothing about which
 * institute they may see. Every gated read still resolves the tenant from the
 * Host header and checks `memberships` for that tenant, so a session minted on
 * one institute's domain grants exactly nothing on another's, even though the
 * row lives in a shared table.
 *
 * Cookies are host-scoped by default, so the token is not even transmitted
 * across tenant domains. That is a second line rather than the first one: the
 * membership check is what actually enforces it.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/**
 * Credentials and linked providers. `password` holds the hash for the
 * email-and-password provider, which is why nothing may select this table
 * outside the auth layer.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    unique('accounts_provider_id_account_id_key').on(
      table.providerId,
      table.accountId,
    ),
  ],
);

/** Short-lived tokens for email verification and password reset. */
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);
