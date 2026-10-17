-- Catalog search is substring matching, not word matching: Postgres's default text-search
-- parser does not segment Thai or Chinese, so `to_tsvector('simple', 'สนุกมาก')` is one
-- lexeme and a search for `สนุก` finds nothing. A trigram index answers `LIKE '%term%'`
-- over the same folded expression the catalog query builds, in any script.
--
-- This migration is custom rather than generated because drizzle-kit models columns and
-- btree indexes, not extensions or operator classes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "novels_search_trgm_idx" ON "novels" USING gin (
  (
    lower(
      coalesce("title", '') || ' ' ||
      coalesce("original_title", '') || ' ' ||
      coalesce("author", '')
    )
  ) gin_trgm_ops
);
