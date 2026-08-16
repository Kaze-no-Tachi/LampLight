import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { productKind } from './enums';
import { memberships, users } from './identity';
import { tenants } from './tenancy';

/**
 * The sellable unit. Both programs and courses point at a product row, which
 * is what carries price and Stripe state. Products live on the tenant's
 * connected account, so stripe_price_id is tenant-local and never shared
 * (PRD section 8).
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    kind: productKind('kind').notNull(),
    stripePriceId: text('stripe_price_id'),
    priceCents: integer('price_cents').notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    isPublished: boolean('is_published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('products_tenant_id_id_key').on(table.tenantId, table.id),
    unique('products_tenant_id_stripe_price_id_key').on(
      table.tenantId,
      table.stripePriceId,
    ),
  ],
);

export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    descriptionMd: text('description_md'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('programs_tenant_id_id_key').on(table.tenantId, table.id),
    unique('programs_tenant_id_slug_key').on(table.tenantId, table.slug),
    unique('programs_tenant_id_product_id_key').on(
      table.tenantId,
      table.productId,
    ),
    foreignKey({
      name: 'programs_tenant_id_product_id_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete('cascade'),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    descriptionMd: text('description_md'),
    // A course inside a program may or may not be sellable on its own. That is
    // a per-course decision the institute makes (PRD section 6).
    isStandalonePurchasable: boolean('is_standalone_purchasable')
      .notNull()
      .default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('courses_tenant_id_id_key').on(table.tenantId, table.id),
    unique('courses_tenant_id_slug_key').on(table.tenantId, table.slug),
    unique('courses_tenant_id_product_id_key').on(
      table.tenantId,
      table.productId,
    ),
    foreignKey({
      name: 'courses_tenant_id_product_id_fk',
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
    }).onDelete('cascade'),
  ],
);

/** Program membership. Ordered but not gated (prerequisites are a non-goal). */
export const programCourses = pgTable(
  'program_courses',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    programId: uuid('program_id').notNull(),
    courseId: uuid('course_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    primaryKey({
      name: 'program_courses_pkey',
      columns: [table.tenantId, table.programId, table.courseId],
    }),
    index('program_courses_tenant_id_course_id_idx').on(
      table.tenantId,
      table.courseId,
    ),
    foreignKey({
      name: 'program_courses_tenant_id_program_id_fk',
      columns: [table.tenantId, table.programId],
      foreignColumns: [programs.tenantId, programs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'program_courses_tenant_id_course_id_fk',
      columns: [table.tenantId, table.courseId],
      foreignColumns: [courses.tenantId, courses.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Instructor assignment. The user foreign key targets memberships rather than
 * users, so an instructor is structurally required to be a member of the same
 * tenant as the course.
 */
export const courseInstructors = pgTable(
  'course_instructors',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'course_instructors_pkey',
      columns: [table.tenantId, table.courseId, table.userId],
    }),
    foreignKey({
      name: 'course_instructors_tenant_id_course_id_fk',
      columns: [table.tenantId, table.courseId],
      foreignColumns: [courses.tenantId, courses.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'course_instructors_tenant_id_user_id_fk',
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
  ],
);
