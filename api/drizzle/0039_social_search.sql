-- Recherche sociale : pleine texte française + trigrammes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('french', coalesce("caption", ''))) STORED;--> statement-breakpoint
CREATE INDEX "hashtags_tag_trgm_idx" ON "hashtags" USING gin ("tag" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "publications_search_idx" ON "publications" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "users_username_trgm_idx" ON "users" USING gin ("username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_display_name_trgm_idx" ON "users" USING gin ("display_name" gin_trgm_ops);