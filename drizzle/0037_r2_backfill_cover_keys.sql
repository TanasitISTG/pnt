-- Folds the object keys produced by `bun run storage:migrate` into the new columns.
-- That script must run before this migration; it stages one row per novel that still
-- carries legacy `cover` bytes into `r2_migration_covers`. A database with no legacy
-- covers (fresh install, CI) has no map table and skips the step entirely.
-- The drop is a separate statement because CockroachDB cannot build `DROP TABLE` inside
-- a PL/pgSQL block ("unimplemented: DROP TABLE usage inside a function definition"), and
-- that failure happens at statement-build time, so it would break every database on that
-- engine even when the block's body never runs. `DROP TABLE IF EXISTS` keeps the
-- fresh-install path a no-op.
DO $$
BEGIN
  IF to_regclass('public.r2_migration_covers') IS NOT NULL THEN
    UPDATE "novels" AS n
    SET "cover_key" = m."cover_key",
        "cover_mime" = COALESCE(m."cover_mime", n."cover_mime")
    FROM "r2_migration_covers" AS m
    WHERE n."id" = m."novel_id";
  END IF;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "r2_migration_covers";
