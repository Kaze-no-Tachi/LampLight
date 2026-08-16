-- Claiming a hostname stops being exclusive; verifying one starts being.
--
-- The old plain unique on hostname made a claim exclusive from the moment it
-- was typed. Any institute could enter a competitor's domain and permanently
-- block them from ever attaching it, owning nothing and proving nothing, and
-- the platform had no way to tell a squatter from a slow DNS change.
--
-- Uniqueness now applies only to rows that actually resolve. Several
-- institutes may hold a pending claim on the same name; whichever proves
-- ownership through DNS gets it, and after that nobody else can. That is
-- exactly the property Host-header resolution needs, and no more.
--
-- The partial index is hand written because drizzle-kit does not generate
-- partial indexes. Without it, dropping the unique above would leave two
-- institutes able to serve the same hostname, which is the ambiguity ADR 0001
-- was guarding against in the first place.

ALTER TABLE "tenant_domains" DROP CONSTRAINT "tenant_domains_hostname_unique";--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "dns_records_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_hostname_key" UNIQUE("tenant_id","hostname");--> statement-breakpoint

-- The constraint that actually matters. Two active rows for one hostname would
-- make resolve_tenant_by_host return whichever the planner reached first.
CREATE UNIQUE INDEX "tenant_domains_active_hostname_key"
  ON "tenant_domains" ("hostname")
  WHERE "verification_status" = 'active';--> statement-breakpoint

-- Supersedes the plain partial index from 0002. Same column, same predicate,
-- so it served the resolution lookup and nothing else; the unique version
-- above serves that lookup and enforces the constraint too.
DROP INDEX IF EXISTS "tenant_domains_active_hostname_idx";
