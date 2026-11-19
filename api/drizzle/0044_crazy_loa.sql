CREATE TYPE "public"."comment_kind" AS ENUM('text', 'audio', 'image', 'sticker');--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "body" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "kind" "comment_kind" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "media_asset_id" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "sticker_ref" text;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;