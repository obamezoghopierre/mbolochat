-- Supprime la table des intérêts : les scores sont recalculés par l'usage, rien
-- d'autre ne dépend d'elle tant que le classement ne la lit pas.
DROP INDEX IF EXISTS "user_interests_updated_idx";
DROP INDEX IF EXISTS "user_interests_user_score_idx";
DROP INDEX IF EXISTS "user_interests_user_subject_uidx";
DROP TABLE IF EXISTS "user_interests";
