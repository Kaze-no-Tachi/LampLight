-- Deferred activation: signup creates an invitation, not an account.
--
-- The generated portion of this file is everything above the row-level
-- security block. The block itself is hand written, because drizzle-kit does
-- not generate policies, and a new tenant-owned table without one is a table
-- that reads across institutes. tests/isolation/rls-coverage.test.ts asserts
-- against the live database in both directions, so forgetting this fails CI
-- rather than shipping.

CREATE TYPE "public"."signup_mode" AS ENUM('closed', 'open');--> statement-breakpoint
CREATE TABLE "signup_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"answers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"role" "membership_role" DEFAULT 'student' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_invitations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "signup_invitations_tenant_id_token_hash_key" UNIQUE("tenant_id","token_hash")
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "signup_mode" "signup_mode" DEFAULT 'closed' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "signup_questions_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "profile_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "signup_invitations" ADD CONSTRAINT "signup_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signup_invitations_tenant_id_email_idx" ON "signup_invitations" USING btree ("tenant_id","email");--> statement-breakpoint

-- Row-level security, same treatment as every other tenant-owned table.
-- See the header of 0001_rls_policies.sql for what each line buys.
ALTER TABLE "signup_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signup_invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "signup_invitations"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());