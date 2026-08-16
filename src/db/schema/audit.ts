import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity';
import { tenants } from './tenancy';

/**
 * Every superadmin action and every manual entitlement grant writes a row here
 * (PRD sections 5.1 and 10, P0-11).
 *
 * actor_user_id references users rather than memberships on purpose: a
 * platform operator acting on a tenant is not a member of that tenant, so a
 * membership-scoped foreign key would make the most important rows in this
 * table impossible to write.
 *
 * target_id is polymorphic across target_type and therefore carries no
 * foreign key.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('audit_log_tenant_id_id_key').on(table.tenantId, table.id),
    index('audit_log_tenant_id_created_at_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);
