-- Seed the history for chapters that were translated before the table existed, so the newest
-- version is the current text on day one and every chapter the owner opens has something to
-- compare against. The timestamp is the moment the text was produced (`translated_at`), not
-- the moment this migration ran, which is what keeps the list honest about its ages.
--
-- Idempotent by construction: a chapter that already has a version is left alone, so running
-- the migration twice cannot double its history.
INSERT INTO "chapter_translation_versions" (
  "id",
  "chapter_id",
  "generation",
  "source_revision",
  "origin",
  "job_id",
  "translated_title",
  "content",
  "summary",
  "char_count",
  "created_at"
)
SELECT
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 21),
  c."id",
  c."translation_generation",
  c."source_revision",
  'import',
  NULL,
  c."translated_title",
  c."translated_content",
  NULL,
  length(c."translated_content"),
  coalesce(c."translated_at", c."updated_at")
FROM "chapters" AS c
WHERE c."translated_content" IS NOT NULL
  AND btrim(c."translated_content") <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "chapter_translation_versions" AS v
    WHERE v."chapter_id" = c."id"
  );
