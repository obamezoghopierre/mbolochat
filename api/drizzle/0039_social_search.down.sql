-- Retour arrière manuel de 0039_social_search (jamais exécuté automatiquement).
DROP INDEX IF EXISTS "users_display_name_trgm_idx";
DROP INDEX IF EXISTS "users_username_trgm_idx";
DROP INDEX IF EXISTS "publications_search_idx";
DROP INDEX IF EXISTS "hashtags_tag_trgm_idx";
ALTER TABLE "publications" DROP COLUMN IF EXISTS "search_vector";
-- L'extension pg_trgm reste installée : d'autres objets peuvent en dépendre.
