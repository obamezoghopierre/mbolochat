DROP INDEX IF EXISTS "publications_quoted_idx";--> statement-breakpoint
ALTER TABLE "publications" DROP CONSTRAINT IF EXISTS "publications_quoted_publication_id_publications_id_fk";--> statement-breakpoint
ALTER TABLE "publications" DROP COLUMN IF EXISTS "quoted_publication_id";
