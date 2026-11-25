DROP INDEX IF EXISTS "comment_sessions_expiry_idx";
DROP INDEX IF EXISTS "comment_sessions_user_publication_idx";
DROP TABLE IF EXISTS "comment_sessions";
ALTER TABLE "feed_sessions" DROP COLUMN IF EXISTS "city";
ALTER TABLE "feed_sessions" DROP COLUMN IF EXISTS "format";
