CREATE TABLE "comment_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"publication_id" text NOT NULL,
	"comment_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_sessions" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "feed_sessions" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "comment_sessions" ADD CONSTRAINT "comment_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_sessions" ADD CONSTRAINT "comment_sessions_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_sessions_user_publication_idx" ON "comment_sessions" USING btree ("user_id","publication_id","created_at");--> statement-breakpoint
CREATE INDEX "comment_sessions_expiry_idx" ON "comment_sessions" USING btree ("expires_at");--> statement-breakpoint
UPDATE "publications" AS p
SET "comment_count" = (
  SELECT count(*)::int
  FROM "comments" AS c
  WHERE c."publication_id" = p."id"
    AND c."deleted_at" IS NULL
    AND c."moderation_status" IN ('pending', 'approved')
);--> statement-breakpoint
UPDATE "comments" AS parent
SET "reply_count" = (
  SELECT count(*)::int
  FROM "comments" AS child
  WHERE child."parent_id" = parent."id"
    AND child."deleted_at" IS NULL
    AND child."moderation_status" IN ('pending', 'approved')
);