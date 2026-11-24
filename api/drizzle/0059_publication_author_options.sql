ALTER TABLE "publications" ADD COLUMN "comments_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "hide_like_count" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "pinned_at" timestamp with time zone;
