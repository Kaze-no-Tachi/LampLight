-- Row-level security: the second isolation layer (PRD section 5.1).
--
-- Every tenant-owned table gets the same treatment:
--
--   ENABLE ROW LEVEL SECURITY
--     Policies now apply to ordinary roles reading this table.
--
--   FORCE ROW LEVEL SECURITY
--     Policies also apply to the table OWNER. Without this, anyone who
--     connected as the owning role would silently bypass every policy. The
--     application is not supposed to connect as the owner, but a self-hoster
--     who wires one connection string for everything would otherwise lose the
--     entire database layer without any signal. A role holding the BYPASSRLS
--     attribute (the superadmin role) still bypasses, which is intended.
--
--   POLICY tenant_isolation
--     tenant_id = current_setting('app.tenant_id', true)::uuid
--
--     The second argument to current_setting is missing_ok. When the GUC has
--     never been set the call returns NULL, the comparison evaluates to NULL
--     rather than TRUE, and the row is filtered out. So a query that forgot to
--     establish a tenant returns zero rows instead of everything. The failure
--     mode is closed.
--
--     nullif(..., '') guards the case where the GUC is set to an empty string,
--     which would otherwise raise an invalid-input-syntax error on the ::uuid
--     cast and turn a data-isolation question into a 500.
--
--     USING governs which rows are visible to SELECT, UPDATE, and DELETE.
--     WITH CHECK governs which rows INSERT and UPDATE are allowed to write, so
--     a tenant cannot write a row stamped with someone else's tenant_id.
--
-- app.tenant_id is set per transaction by getTenantDb (src/db/client.ts) using
-- set_config(..., is_local => true), so it is cleared on commit or rollback
-- and cannot leak to the next checkout of a pooled connection.

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;
--> statement-breakpoint

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "course_instructors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_instructors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "course_instructors"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "courses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "courses"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enrollments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "enrollments"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "lesson_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lesson_resources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lesson_resources"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "lessons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lessons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lessons"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "modules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "modules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "modules"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "program_courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "program_courses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "program_courses"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "programs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "programs"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "progress" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "progress"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "tenant_billing" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_billing" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_billing"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "tenant_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_domains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_domains"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_settings"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- enrollments.granted_by delete behaviour
-- ---------------------------------------------------------------------------
-- Drizzle emits this composite foreign key with ON DELETE NO ACTION because it
-- cannot express Postgres 15's column-list form of SET NULL. A bare
-- ON DELETE SET NULL would try to null every referencing column, including
-- tenant_id, which is NOT NULL, so removing an admin's membership would fail
-- with a not-null violation on any scholarship they had granted.
--
-- Nulling only granted_by is the behaviour we want: the student keeps the
-- entitlement, and the record of who granted it survives in audit_log.
ALTER TABLE "enrollments"
  DROP CONSTRAINT "enrollments_tenant_id_granted_by_fk";--> statement-breakpoint
ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_tenant_id_granted_by_fk"
  FOREIGN KEY ("tenant_id", "granted_by")
  REFERENCES "public"."memberships"("tenant_id", "user_id")
  ON DELETE SET NULL ("granted_by");
