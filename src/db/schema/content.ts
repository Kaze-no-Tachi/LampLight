import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { courses } from './catalog';
import { lessonResourceKind } from './enums';
import { tenants } from './tenancy';

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    title: text('title').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('modules_tenant_id_id_key').on(table.tenantId, table.id),
    index('modules_tenant_id_course_id_idx').on(table.tenantId, table.courseId),
    foreignKey({
      name: 'modules_tenant_id_course_id_fk',
      columns: [table.tenantId, table.courseId],
      foreignColumns: [courses.tenantId, courses.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Lessons hang off modules, so the course a lesson belongs to is reached by
 * joining through modules. The access predicate needs that course id on every
 * call, which is why the lesson repository exposes a lessonWithCourse read
 * rather than a bare lesson select.
 *
 * Slug uniqueness is scoped to the module. If lesson URLs later become
 * course-scoped rather than module-scoped, this needs to widen to the course,
 * which means denormalising course_id onto lessons.
 */
export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    contentMd: text('content_md'),
    durationSeconds: integer('duration_seconds'),
    isFreePreview: boolean('is_free_preview').notNull().default(false),
    /**
     * Draft until somebody says otherwise.
     *
     * Distinct from isFreePreview, which answers "may a stranger listen to
     * this", not "is this finished". A course could be published while a
     * lesson inside it was still being written, and the only way to hide the
     * half-written one was to hold back the whole course.
     */
    isPublished: boolean('is_published').notNull().default(false),
    /**
     * Set when somebody removes a lesson. Nothing is destroyed: a lesson
     * carries other people's progress rows, and a delete that takes those with
     * it is not recoverable from a mistake.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('lessons_tenant_id_id_key').on(table.tenantId, table.id),
    unique('lessons_tenant_id_module_id_slug_key').on(
      table.tenantId,
      table.moduleId,
      table.slug,
    ),
    index('lessons_tenant_id_module_id_idx').on(table.tenantId, table.moduleId),
    foreignKey({
      name: 'lessons_tenant_id_module_id_fk',
      columns: [table.tenantId, table.moduleId],
      foreignColumns: [modules.tenantId, modules.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Media and attachments. storage_key is the R2 object key and is always
 * prefixed t/{tenant_id}/ server-side, never taken from the client
 * (PRD section 5.5).
 */
export const lessonResources = pgTable(
  'lesson_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id').notNull(),
    kind: lessonResourceKind('kind').notNull(),
    storageKey: text('storage_key'),
    url: text('url'),
    filename: text('filename'),
    byteSize: bigint('byte_size', { mode: 'number' }),
    isDownloadable: boolean('is_downloadable').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('lesson_resources_tenant_id_id_key').on(table.tenantId, table.id),
    index('lesson_resources_tenant_id_lesson_id_idx').on(
      table.tenantId,
      table.lessonId,
    ),
    foreignKey({
      name: 'lesson_resources_tenant_id_lesson_id_fk',
      columns: [table.tenantId, table.lessonId],
      foreignColumns: [lessons.tenantId, lessons.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Documents that belong to a course rather than to one of its lessons: the
 * syllabus, a reading list, a handout that spans the whole term.
 *
 * A separate table from lesson_resources rather than a nullable lesson_id on
 * that one. A nullable foreign key would make every query that joins lessons
 * to their resources carry an "and the lesson is not null" it can forget, and
 * the composite key that makes cross-tenant references structurally impossible
 * only works when the column is not null. Two tables, two honest shapes.
 *
 * Access differs too, which is the real argument. Lesson resources sit behind
 * the access predicate because they are the thing being sold. A syllabus is
 * what somebody reads while deciding whether to enrol, so it is readable by
 * anyone who can see the course, and `is_public` says which is which.
 */
export const courseResources = pgTable(
  'course_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    kind: lessonResourceKind('kind').notNull(),
    title: text('title').notNull().default(''),
    storageKey: text('storage_key'),
    url: text('url'),
    filename: text('filename'),
    byteSize: bigint('byte_size', { mode: 'number' }),
    /**
     * Whether somebody who has not enrolled may open it.
     *
     * A syllabus usually should be, because it is how a person decides to buy.
     * Defaults to false so that publishing something by accident takes a
     * deliberate act rather than an oversight.
     */
    isPublic: boolean('is_public').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('course_resources_tenant_id_id_key').on(table.tenantId, table.id),
    index('course_resources_tenant_id_course_id_idx').on(
      table.tenantId,
      table.courseId,
    ),
    foreignKey({
      name: 'course_resources_tenant_id_course_id_fk',
      columns: [table.tenantId, table.courseId],
      foreignColumns: [courses.tenantId, courses.id],
    }).onDelete('cascade'),
  ],
);
