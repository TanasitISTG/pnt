-- Give every novel that already has an author its canonical row, so the author directory is
-- not empty until each publisher happens to save a novel again.
--
-- The fold here is the one the application applies (`normalizeAuthorName`): trim, collapse
-- internal whitespace, lowercase. SQL cannot normalize Unicode composition, which is why
-- the application does not either — the two have to agree exactly or the same author gets
-- two rows.
INSERT INTO "novel_authors" ("id", "name", "normalized_name")
SELECT DISTINCT ON (folded.normalized)
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 21),
  folded.display,
  folded.normalized
FROM (
  SELECT
    lower(regexp_replace(btrim("author"), '\s+', ' ', 'g')) AS normalized,
    btrim("author") AS display,
    count(*) AS uses
  FROM "novels"
  WHERE "author" IS NOT NULL AND btrim("author") <> ''
  GROUP BY 1, 2
) AS folded
-- The most-used spelling becomes the display name, so a row is named the way most of its
-- novels already spell it rather than by whichever variant the insert happened to read.
ORDER BY folded.normalized, folded.uses DESC, folded.display ASC
ON CONFLICT ("normalized_name") DO NOTHING;
--> statement-breakpoint
UPDATE "novels" AS n
SET "author_id" = a."id"
FROM "novel_authors" AS a
WHERE n."author" IS NOT NULL
  AND n."author_id" IS NULL
  AND lower(regexp_replace(btrim(n."author"), '\s+', ' ', 'g')) = a."normalized_name";
