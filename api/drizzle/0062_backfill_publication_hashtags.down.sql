-- Le rattrapage n'est pas annulé : les liens publication_hashtags et les
-- hashtags qu'il a créés (usage_count = 0) sont corrects et exploités par la
-- recherche. Les retirer demanderait de les distinguer de ceux écrits ensuite
-- par l'application.
SELECT 1;
