-- Retour arrière manuel (jamais exécuté automatiquement, cf. AGENTS.md).
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_voice_media_asset_id_media_assets_id_fk";
ALTER TABLE "comments" DROP COLUMN IF EXISTS "voice_media_asset_id";
