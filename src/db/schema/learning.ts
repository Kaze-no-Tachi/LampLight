import {
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { lessons } from './content';
import { memberships, users } from './identity';
import { tenants } from './tenancy';

/**
 * Playback position, synced server-side so a student resumes at the same
 * second on another device. One row per (tenant, user, lesson).
 */
export const progress = pgTable(
  'progress',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id').notNull(),
    positionSeconds: integer('position_seconds').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'progress_pkey',
      columns: [table.tenantId, table.userId, table.lessonId],
    }),
    foreignKey({
      name: 'progress_tenant_id_user_id_fk',
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'progress_tenant_id_lesson_id_fk',
      columns: [table.tenantId, table.lessonId],
      foreignColumns: [lessons.tenantId, lessons.id],
    }).onDelete('cascade'),
  ],
);
