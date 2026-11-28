CREATE TABLE "publication_topics" (
	"publication_id" text NOT NULL,
	"topic" text NOT NULL,
	CONSTRAINT "publication_topics_publication_id_topic_pk" PRIMARY KEY("publication_id","topic")
);--> statement-breakpoint
ALTER TABLE "publication_topics" ADD CONSTRAINT "publication_topics_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_topics_topic_idx" ON "publication_topics" USING btree ("topic");
