-- URL import is gone, and PostgreSQL cannot remove an enum value while rows still use it.
-- Drop the history of the feature with the feature: the item rows first (the foreign key is
-- cascade, but naming them keeps this readable), then the jobs themselves.
DELETE FROM "import_job_items"
WHERE "job_id" IN (SELECT "id" FROM "import_jobs" WHERE "kind" = 'scrape');
--> statement-breakpoint
DELETE FROM "import_jobs" WHERE "kind" = 'scrape';
