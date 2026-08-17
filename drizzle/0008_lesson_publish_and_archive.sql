ALTER TABLE "courses" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "is_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
-- Everything that already exists was visible, so it stays visible.
--
-- The column defaults to false because a NEW lesson should be a draft, and the
-- ALTER above therefore lands false on every existing row. Left alone, this
-- migration would silently unpublish every lesson on every institute at the
-- moment it ran, with no error and no obvious cause. The default is right for
-- tomorrow's lessons and wrong for yesterday's.
UPDATE "lessons" SET "is_published" = true;
