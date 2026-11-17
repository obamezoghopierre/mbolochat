-- Retour arrière manuel (jamais exécuté automatiquement, cf. AGENTS.md).
DROP INDEX IF EXISTS "publications_visibility_hot_idx";
DROP INDEX IF EXISTS "publications_feed_hot_idx";
DROP INDEX IF EXISTS "publication_views_publication_idx";
DROP INDEX IF EXISTS "media_jobs_asset_kind_idx";
ALTER TABLE "publication_views" DROP COLUMN IF EXISTS "completed";
ALTER TABLE "publication_views" DROP COLUMN IF EXISTS "watch_ms";
