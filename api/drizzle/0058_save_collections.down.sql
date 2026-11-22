DROP INDEX IF EXISTS "publication_saves_collection_idx";
ALTER TABLE "publication_saves" DROP CONSTRAINT IF EXISTS "publication_saves_collection_id_save_collections_id_fk";
ALTER TABLE "publication_saves" DROP COLUMN IF EXISTS "collection_id";
DROP TABLE IF EXISTS "save_collections";
