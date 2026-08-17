-- Archiving a course frees its slug, per the round 2 decision. The plain
-- unique on (tenant_id, slug) made an archived course's address permanently
-- unavailable, so an institute retiring "old-testament-survey" and writing a
-- new course under the same name would be told it was taken by a course
-- nobody can see or reach any more.
--
-- The partial index is hand written because drizzle-kit does not generate
-- partial indexes, the same reason tenant_domains has one (migration 0006).
ALTER TABLE "courses" DROP CONSTRAINT "courses_tenant_id_slug_key";--> statement-breakpoint

CREATE UNIQUE INDEX "courses_tenant_id_slug_active_key"
  ON "courses" ("tenant_id", "slug")
  WHERE "archived_at" IS NULL;
