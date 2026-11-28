-- Rattrapage des hashtags explicites : publication_hashtags n'a jamais été
-- écrite jusqu'ici. On lit les légendes (et les pages d'un post texte) des
-- publications non supprimées. Reproduit extractHashtags : minuscules, accents
-- courants retirés (unaccent n'est pas garanti), 30 caractères au plus.
-- PostgreSQL n'a pas de lookbehind : le caractère qui précède le # est capturé
-- (groupe 1) et exigé non alphanumérique, ou début de texte. Aucune table
-- temporaire : chaque instruction se suffit à elle-même.
INSERT INTO "hashtags" ("id", "tag", "usage_count")
SELECT gen_random_uuid()::text, t."tag", 0
FROM (
  SELECT DISTINCT translate(lower(m[2]),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
    'aaaaaaceeeeiiiinooooouuuuyy') AS "tag"
  FROM "publications" p
  CROSS JOIN LATERAL regexp_matches(
    coalesce(p."caption", '') || ' ' || CASE
      WHEN jsonb_typeof(p."text_pages") = 'array'
      THEN (SELECT string_agg(page, ' ') FROM jsonb_array_elements_text(p."text_pages") AS page)
      ELSE ''
    END,
    '(^|[^[:alnum:]_])#([[:alnum:]_]{1,30})',
    'g'
  ) AS m
  WHERE p."deleted_at" IS NULL
) t
WHERE t."tag" <> ''
ON CONFLICT ("tag") DO NOTHING;--> statement-breakpoint
INSERT INTO "publication_hashtags" ("publication_id", "hashtag_id")
SELECT DISTINCT p."id", h."id"
FROM "publications" p
CROSS JOIN LATERAL regexp_matches(
  coalesce(p."caption", '') || ' ' || CASE
    WHEN jsonb_typeof(p."text_pages") = 'array'
    THEN (SELECT string_agg(page, ' ') FROM jsonb_array_elements_text(p."text_pages") AS page)
    ELSE ''
  END,
  '(^|[^[:alnum:]_])#([[:alnum:]_]{1,30})',
  'g'
) AS m
JOIN "hashtags" h ON h."tag" = translate(lower(m[2]),
  'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
  'aaaaaaceeeeiiiinooooouuuuyy')
WHERE p."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
