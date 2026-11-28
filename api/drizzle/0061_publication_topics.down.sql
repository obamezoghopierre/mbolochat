-- Annule la table des sujets implicites. Les liens publication_hashtags écrits
-- par le rattrapage et les hashtags créés par lui (usage_count = 0) restent :
-- ils sont corrects et la recherche s'en sert. Les retirer exigerait de les
-- distinguer des liens écrits ensuite par l'application.
DROP INDEX IF EXISTS "publication_topics_topic_idx";
DROP TABLE IF EXISTS "publication_topics";
