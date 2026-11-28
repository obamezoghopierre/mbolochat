CREATE TABLE "user_interests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_interests_user_subject_uidx" ON "user_interests" USING btree ("user_id","kind","subject");--> statement-breakpoint
CREATE INDEX "user_interests_user_score_idx" ON "user_interests" USING btree ("user_id","score");--> statement-breakpoint
CREATE INDEX "user_interests_updated_idx" ON "user_interests" USING btree ("updated_at");
