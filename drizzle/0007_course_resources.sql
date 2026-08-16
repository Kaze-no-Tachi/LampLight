-- Documents that belong to a course rather than to one of its lessons.
--
-- The RLS block below is hand written, as always: drizzle-kit does not
-- generate policies, and a new tenant-owned table without one reads across
-- institutes. tests/isolation/rls-coverage.test.ts asserts against the live
-- database in both directions, so forgetting it fails CI.

CREATE TABLE "course_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" "lesson_resource_kind" NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"storage_key" text,
	"url" text,
	"filename" text,
	"byte_size" bigint,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_resources_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "course_resources" ADD CONSTRAINT "course_resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_resources" ADD CONSTRAINT "course_resources_tenant_id_course_id_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_resources_tenant_id_course_id_idx" ON "course_resources" USING btree ("tenant_id","course_id");
--> statement-breakpoint

ALTER TABLE "course_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_resources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "course_resources"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
