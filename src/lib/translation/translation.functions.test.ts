import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./translation.functions.ts", import.meta.url)),
  "utf8",
);

describe("translation batch query predicates", () => {
  it("does not interpolate arrays into raw ANY predicates", () => {
    expect(source).not.toContain("ANY(${");
  });

  it("sorts selected chapters in numeric ascending order with COALESCE(number::numeric, 0)", () => {
    expect(source).toContain("asc(sql`COALESCE(${chapters.number}::numeric, 0)`)");
  });

  it("returns totalChunks from startTranslationJob", () => {
    expect(source).toContain("return { jobId: queued.jobId, totalChunks: queued.totalChunks };");
  });

  it("returns queued and skipped arrays from startTranslationJobs", () => {
    expect(source).toContain("return { queued, skipped };");
  });

  it("enqueues batch jobs with bounded concurrency", () => {
    expect(source).toContain("const BATCH_ENQUEUE_CONCURRENCY = 2;");
    expect(source).toContain("mapWithConcurrency(");
    expect(source).toContain("BATCH_ENQUEUE_CONCURRENCY");
  });
});
