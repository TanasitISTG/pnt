import { describe, expect, it } from "vitest";

import { jobHistorySearchSchema, normalizeJobStats } from "@/lib/job-dashboard/contracts";

describe("jobHistorySearchSchema", () => {
  it("normalizes omitted search values to the canonical defaults", () => {
    expect(jobHistorySearchSchema.parse({})).toEqual({
      q: "",
      type: "all",
      status: "all",
      sort: "updatedAt",
      dir: "desc",
      page: 1,
      pageSize: 25,
    });
  });

  it("trims bounded queries and accepts URL-encoded numeric values", () => {
    expect(
      jobHistorySearchSchema.parse({
        q: "  older job  ",
        page: "2",
        pageSize: "50",
      }),
    ).toMatchObject({
      q: "older job",
      page: 2,
      pageSize: 50,
    });
  });

  it("rejects invalid pages and unsupported page sizes", () => {
    expect(() => jobHistorySearchSchema.parse({ page: 0 })).toThrow();
    expect(() => jobHistorySearchSchema.parse({ page: -1 })).toThrow();
    expect(() => jobHistorySearchSchema.parse({ pageSize: 20 })).toThrow();
  });

  it("rejects queries longer than the server limit", () => {
    expect(() => jobHistorySearchSchema.parse({ q: "x".repeat(101) })).toThrow();
  });
});

describe("normalizeJobStats", () => {
  it("normalizes missing aggregates and counts to zeroes", () => {
    expect(normalizeJobStats(undefined)).toEqual({
      avgChunkLatencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      activeTranslationJobs: 0,
      failedTranslationJobs: 0,
      activeImportJobs: 0,
      failedImportJobs: 0,
    });
  });

  it("preserves aggregate values while converting nullable results", () => {
    expect(
      normalizeJobStats(
        { avgLatencyMs: 42, promptTokens: null, completionTokens: 18 },
        { activeJobs: 3, failedJobs: 2 },
        { activeJobs: null, failedJobs: 4 },
      ),
    ).toEqual({
      avgChunkLatencyMs: 42,
      promptTokens: 0,
      completionTokens: 18,
      activeTranslationJobs: 3,
      failedTranslationJobs: 2,
      activeImportJobs: 0,
      failedImportJobs: 4,
    });
  });
});
