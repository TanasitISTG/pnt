import { describe, expect, it } from "vitest";

import { normalizeJobStats, summarizeJobActivity } from "@/lib/job-observability";

describe("summarizeJobActivity", () => {
  it("counts active and failed jobs from the returned recent rows", () => {
    expect(
      summarizeJobActivity(
        [{ status: "pending" }, { status: "running" }, { status: "error" }, { status: "done" }],
        [{ status: "running" }, { status: "error" }, { status: "cancelled" }],
      ),
    ).toEqual({
      activeTranslationJobs: 2,
      failedTranslationJobs: 1,
      activeImportJobs: 1,
      failedImportJobs: 1,
    });
  });
});

describe("normalizeJobStats", () => {
  it("normalizes a missing aggregate row to zeroes", () => {
    expect(normalizeJobStats(undefined)).toEqual({
      avgChunkLatencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
    });
  });

  it("preserves aggregate values while converting nullable results", () => {
    expect(
      normalizeJobStats({ avgLatencyMs: 42, promptTokens: null, completionTokens: 18 }),
    ).toEqual({
      avgChunkLatencyMs: 42,
      promptTokens: 0,
      completionTokens: 18,
    });
  });
});
