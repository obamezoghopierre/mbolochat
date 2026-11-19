-- Retour arrière manuel (jamais exécuté automatiquement, cf. AGENTS.md).
DROP TABLE IF EXISTS "comment_reactions";
DROP TYPE IF EXISTS "comment_reaction_kind";
ALTER TABLE "comments" DROP COLUMN IF EXISTS "pinned_at";
