-- The institute's own subject vocabulary, and the courses that carry each tag.
--
-- The RLS block below is hand written, as always: drizzle-kit does not
-- generate policies, and a new tenant-owned table without one reads across
-- institutes. tests/isolation/rls-coverage.test.ts asserts against the live
-- database in both directions, so forgetting it fails CI.

CREATE TABLE "course_tag_links" (
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "course_tag_links_pkey" PRIMARY KEY("tenant_id","course_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "course_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_tags_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "course_tags_tenant_id_slug_key" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
ALTER TABLE "course_tag_links" ADD CONSTRAINT "course_tag_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tag_links" ADD CONSTRAINT "course_tag_links_tenant_id_course_id_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tag_links" ADD CONSTRAINT "course_tag_links_tenant_id_tag_id_fk" FOREIGN KEY ("tenant_id","tag_id") REFERENCES "public"."course_tags"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tags" ADD CONSTRAINT "course_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_tag_links_tenant_id_tag_id_idx" ON "course_tag_links" USING btree ("tenant_id","tag_id");
--> statement-breakpoint

ALTER TABLE "course_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "course_tags"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());--> statement-breakpoint

ALTER TABLE "course_tag_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "course_tag_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "course_tag_links"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());
