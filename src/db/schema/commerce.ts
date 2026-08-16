import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { products } from './catalog';
import { enrollmentSourceKind, orderStatus } from './enums';
import { memberships, users } from './identity';
import { tenants } from './tenancy';

/**
 * Entitlements.
 *
 * source_kind plus source_id is a polymorphic reference to either a program or
 * a course, so it cannot carry a foreign key. That is the one place in the
 * schema where referential integrity is enforced in application code instead
 * of by the database, and it is a deliberate trade: the alternative is two
 * nullable columns with a check constraint, which makes every entitlement
 * query branch on which column is populated.
 *
 * granted_by null means the entitlement came from a purchase. Non-null means
 * an admin granted it manually (a scholarship), and the admin is required to
 * be a member of the same tenant.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceKind: enrollmentSourceKind('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    grantedBy: uuid('granted_by'),
  },
  (table) => [
    unique('enrollments_tenant_id_id_key').on(table.tenantId, table.id),
    unique('enrollments_tenant_id_user_id_source_key').on(
      table.tenantId,
      table.userId,
      table.sourceKind,
      table.sourceId,
    ),
    index('enrollments_tenant_id_user_id_idx').on(table.tenantId, table.userId),
    foreignKey({
      name: 'enrollments_tenant_id_user_id_fk',
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
    // MATCH SIMPLE, so a null granted_by (a purchase) skips this check.
    //
    // The delete action is deliberately left at NO ACTION here and upgraded to
    // ON DELETE SET NULL (granted_by) by migration 0001. A plain SET NULL on a
    // composite foreign key nulls every referencing column, which would fail
    // against the NOT NULL on tenant_id. Postgres 15 added the column list
    // form that nulls only granted_by, and Drizzle cannot yet express it.
    foreignKey({
      name: 'enrollments_tenant_id_granted_by_fk',
      columns: [table.tenantId, table.grantedBy],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);

/**
 * One row per Checkout Session. The webhook creates the order and the
 * entitlement in a single transaction, idempotent on stripe_session_id
 * (PRD section 8).
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    stripeSessionId: text('stripe_session_id'),
    stripePaymentIntent: text('stripe_payment_intent'),
    amountCents: integer('amount_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull().default(0),
    status: orderStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('orders_tenant_id_id_key').on(table.tenantId, table.id),
    unique('orders_tenant_id_stripe_session_id_key').on(
      table.tenantId,
      table.stripeSessionId,
    ),
    index('orders_tenant_id_user_id_idx').on(table.tenantId, table.userId),
    foreignKey({
      name: 'orders_tenant_id_user_id_fk',
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'orders_tenant_id_product_id_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete('restrict'),
  ],
);
