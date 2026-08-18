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
    /**
     * Set when somebody removes a course. Archiving rather than deleting,
     * because a course owns lessons, uploaded recordings, enrolments and every
     * student's progress, and cascading all of that away on a misclick is not
     * a thing anybody recovers from. An archived course disappears from every
     * list and frees its slug: a new course may reuse it, per the round 2
     * decision. See the partial index below.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('courses_tenant_id_id_key').on(table.tenantId, table.id),
    // No plain unique on (tenant_id, slug) here, unlike the id key above: an
    // archived course must not hold its address against a new course that
    // reuses it. The real constraint is a hand written partial unique index,
    // courses_tenant_id_slug_active_key (migration 0009), over rows where
    // archived_at is null, same reasoning and same shape as the domain claim
    // index (see tenant_domains in src/db/schema/tenancy.ts).
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

/**
 * The institute's own subject vocabulary.
 *
 * A table rather than a text[] on courses, for two reasons that only show up
 * later. A tenant-owned vocabulary can be renamed once ("OT Survey" becomes
 * "Old Testament") instead of being edited on every course that carries it,
 * and the catalog's filter chips need a stable identity to filter by that
 * survives that rename. An array column gives neither, and de-duplicating free
 * text across a catalog is the thing every institute would end up doing by
 * hand.
 *
 * Scoped like everything else: the composite unique on (tenant_id, id) is what
 * lets the link table below carry a tenant-qualified foreign key, so a course
 * in one institute cannot reference a tag in another even if a bug supplies
 * the wrong id.
 */
export const courseTags = pgTable(
  'course_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    // Used in catalog filter URLs, so it has to stay stable and unique within
    // the institute while the label is free to change.
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('course_tags_tenant_id_id_key').on(table.tenantId, table.id),
    unique('course_tags_tenant_id_slug_key').on(table.tenantId, table.slug),
  ],
);

/**
 * Which tags a course carries.
 *
 * Both foreign keys are tenant-qualified and cascade, so deleting a tag
 * removes it from every course rather than leaving a dangling link, and
 * deleting a course takes its links with it.
 */
export const courseTagLinks = pgTable(
  'course_tag_links',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    tagId: uuid('tag_id').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'course_tag_links_pkey',
      columns: [table.tenantId, table.courseId, table.tagId],
    }),
    // The catalog filters by tag and then lists courses, so the lookup that
    // needs an index is tag -> courses rather than the primary key's order.
    index('course_tag_links_tenant_id_tag_id_idx').on(
      table.tenantId,
      table.tagId,
    ),
    foreignKey({
      name: 'course_tag_links_tenant_id_course_id_fk',
      columns: [table.tenantId, table.courseId],
      foreignColumns: [courses.tenantId, courses.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'course_tag_links_tenant_id_tag_id_fk',
      columns: [table.tenantId, table.tagId],
      foreignColumns: [courseTags.tenantId, courseTags.id],
    }).onDelete('cascade'),
  ],
);
