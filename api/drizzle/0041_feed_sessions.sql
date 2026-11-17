CREATE TYPE "public"."feedback_target" AS ENUM('publication', 'author');--> statement-breakpoint
CREATE TABLE "content_feedback" (
	"user_id" text NOT NULL,
	"target_type" "feedback_target" NOT NULL,
	"target_id" text NOT NULL,
	"kind" text DEFAULT 'not_interested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_feedback_user_id_target_type_target_id_pk" PRIMARY KEY("user_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "feed_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tab" text NOT NULL,
	"publication_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_feedback" ADD CONSTRAINT "content_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_sessions" ADD CONSTRAINT "feed_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_feedback_target_idx" ON "content_feedback" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "feed_sessions_user_idx" ON "feed_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feed_sessions_expiry_idx" ON "feed_sessions" USING btree ("expires_at");