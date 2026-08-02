import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relative: string) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

describe("translation workflow compatibility contract", () => {
  it("persists chapter ownership and source revision fields", () => {
    const schema = source("../db/schema/novels.ts");
    expect(schema).toContain('sourceRevision: integer("source_revision")');
    expect(schema).toContain('translationGeneration: integer("translation_generation")');
    expect(schema).toContain('activeTranslationJobId: text("active_translation_job_id")');
  });

  it("enforces one active job per chapter in the migration", () => {
    const migration = source("../../../drizzle/0021_translation_workflow_integrity.sql");
    expect(migration).toContain("CREATE UNIQUE INDEX");
    expect(migration).toContain("WHERE \"translation_jobs\".\"status\" IN ('pending', 'running')");
  });

  it("uses a durable outbox instead of compensating a failed send by erroring the job", () => {
    const translationFunctions = source("./translation.functions.ts");
    expect(translationFunctions).toContain("translationOutbox");
    expect(translationFunctions).not.toContain('error: "Inngest dispatch failed"');
  });

  it("guards worker persistence with the active job pointer", () => {
    const store = source("./job-store.ts");
    expect(store).toContain("activeTranslationJobId");
    expect(store).toContain("sourceRevision");
    expect(store).toContain("generation");
  });

  it("serializes translation workflows per novel", () => {
    const functions = source("../inngest/functions.ts");
    expect(functions).toContain('key: "event.data.novelId"');
    expect(functions).toContain("limit: 1");
  });

  it("cancels only the exact job generation", () => {
    const functions = source("../inngest/functions.ts");
    const translationFunctions = source("./translation.functions.ts");
    const chapterFunctions = source("../content/chapter.functions.ts");

    expect(functions).toContain("if: TRANSLATION_CANCEL_IF");
    expect(translationFunctions.match(/translationRunIdentity\(cancelled\)/g)).toHaveLength(2);
    expect(translationFunctions).toContain("translationRunIdentity(row.job)");
    expect(chapterFunctions.match(/translationRunIdentity\(cancelledJob\)/g)).toHaveLength(2);
  });
});
