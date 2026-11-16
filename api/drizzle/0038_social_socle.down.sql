-- Retour arrière manuel de 0038_social_socle (jamais exécuté automatiquement).
-- Ordre inverse des dépendances : enfants d'abord, puis `users` et les types.
DROP TABLE IF EXISTS "comment_likes";
DROP TABLE IF EXISTS "social_notifications";
DROP TABLE IF EXISTS "moderation_actions";
DROP TABLE IF EXISTS "reports";
DROP TABLE IF EXISTS "blocked_words";
DROP TABLE IF EXISTS "comments";
DROP TABLE IF EXISTS "publication_hashtags";
DROP TABLE IF EXISTS "hashtags";
DROP TABLE IF EXISTS "publication_views";
DROP TABLE IF EXISTS "publication_reposts";
DROP TABLE IF EXISTS "publication_saves";
DROP TABLE IF EXISTS "publication_reactions";
DROP TABLE IF EXISTS "publication_media";
DROP TABLE IF EXISTS "publications";
DROP TABLE IF EXISTS "sounds";
DROP TABLE IF EXISTS "media_jobs";
DROP TABLE IF EXISTS "highlight_items";
DROP TABLE IF EXISTS "highlights";
DROP TABLE IF EXISTS "story_views";
DROP TABLE IF EXISTS "story_excluded_users";
DROP TABLE IF EXISTS "stories";
DROP TABLE IF EXISTS "follows";
DROP TABLE IF EXISTS "user_social_settings";
-- Dernière : presque toutes les tables sociales la référencent.
DROP TABLE IF EXISTS "media_assets";

ALTER TABLE "users" DROP COLUMN IF EXISTS "username_updated_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "like_received_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "reel_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "publication_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "following_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "follower_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "private_account";
ALTER TABLE "users" DROP COLUMN IF EXISTS "verified";
ALTER TABLE "users" DROP COLUMN IF EXISTS "role";

DROP TYPE IF EXISTS "moderation_action";
DROP TYPE IF EXISTS "report_target_type";
DROP TYPE IF EXISTS "report_status";
DROP TYPE IF EXISTS "report_reason";
DROP TYPE IF EXISTS "social_notification_type";
DROP TYPE IF EXISTS "story_audience";
DROP TYPE IF EXISTS "social_interactor";
DROP TYPE IF EXISTS "media_job_status";
DROP TYPE IF EXISTS "media_job_kind";
DROP TYPE IF EXISTS "media_status";
DROP TYPE IF EXISTS "media_kind";
DROP TYPE IF EXISTS "reaction_kind";
DROP TYPE IF EXISTS "moderation_status";
DROP TYPE IF EXISTS "publication_visibility";
DROP TYPE IF EXISTS "publication_format";
DROP TYPE IF EXISTS "publication_kind";
DROP TYPE IF EXISTS "follow_status";
DROP TYPE IF EXISTS "user_role";
