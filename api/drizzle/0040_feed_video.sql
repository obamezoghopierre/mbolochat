-- Un index unique sur (asset_id, kind) échoue si une base de développement
-- contient déjà des jobs identiques : on ne garde que la ligne la plus récente
-- par couple. En production (base neuve, cf. plan §2), la table est vide.
DELETE FROM "media_jobs" a
USING "media_jobs" b
WHERE a.asset_id = b.asset_id
  AND a.kind = b.kind
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));--> statement-breakpoint
ALTER TABLE "publication_views" ADD COLUMN "watch_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication_views" ADD COLUMN "completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_jobs_asset_kind_idx" ON "media_jobs" USING btree ("asset_id","kind");--> statement-breakpoint
CREATE INDEX "publication_views_publication_idx" ON "publication_views" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "publications_feed_hot_idx" ON "publications" USING btree ("hot_score") WHERE deleted_at is null and moderation_status in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "publications_visibility_hot_idx" ON "publications" USING btree ("visibility","hot_score");