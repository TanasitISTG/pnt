import { describe, expect, it } from "vitest";

import {
  createNovelReportSchema,
  reportQueueInputSchema,
  reportQueueSearchSchema,
  resolveReportCaseSchema,
} from "@/lib/reports/schemas";
import { describeReportReason, describeReportStatus, isReportReason } from "@/lib/reports/reasons";

describe("createNovelReportSchema", () => {
  it("accepts a reason with a short explanation", () => {
    const parsed = createNovelReportSchema.parse({
      novelId: "novel-1",
      reason: "copyright",
      details: "  This is a repost of a licensed translation.  ",
    });

    expect(parsed.details).toBe("This is a repost of a licensed translation.");
  });

  it("accepts a reason that needs no explanation", () => {
    expect(
      createNovelReportSchema.safeParse({ novelId: "novel-1", reason: "sexual_cover" }).success,
    ).toBe(true);
  });

  it("refuses 'other' with nothing written", () => {
    const parsed = createNovelReportSchema.safeParse({ novelId: "novel-1", reason: "other" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["details"]);
  });

  it("refuses details that are only whitespace", () => {
    expect(
      createNovelReportSchema.safeParse({
        novelId: "novel-1",
        reason: "other",
        details: "   ",
      }).success,
    ).toBe(false);
  });

  it("refuses a reason outside the vocabulary", () => {
    expect(
      createNovelReportSchema.safeParse({ novelId: "novel-1", reason: "dislike" }).success,
    ).toBe(false);
  });
});

describe("resolveReportCaseSchema", () => {
  it("requires a note to uphold a case", () => {
    const parsed = resolveReportCaseSchema.safeParse({ caseKey: "novel-1", decision: "upheld" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["note"]);
  });

  it("dismisses without a note", () => {
    expect(
      resolveReportCaseSchema.safeParse({ caseKey: "novel-1", decision: "dismissed" }).success,
    ).toBe(true);
  });

  it("accepts a case keyed by a report once its novel is gone", () => {
    const parsed = resolveReportCaseSchema.parse({
      caseKey: "report-1",
      decision: "dismissed",
      note: "Nothing to act on.",
    });

    expect(parsed.note).toBe("Nothing to act on.");
  });
});

describe("reportQueueSearchSchema", () => {
  it("degrades a hand-edited URL to the default view", () => {
    const parsed = reportQueueInputSchema.parse({ tab: "nonsense", page: "-3", q: "  spam  " });

    expect(parsed).toEqual({ tab: "open", q: "spam", page: 1, pageSize: 25 });
  });

  it("keeps a valid tab and page", () => {
    expect(reportQueueSearchSchema.parse({ tab: "history", page: "2" })).toMatchObject({
      tab: "history",
      page: 2,
    });
  });
});

describe("report vocabulary", () => {
  it("labels known values and falls back to the raw one", () => {
    expect(describeReportReason("copyright")).toBe("Copyright or a stolen translation");
    expect(describeReportReason("unknown")).toBe("unknown");
    expect(describeReportStatus("upheld")).toBe("Upheld");
  });

  it("recognizes only declared reasons", () => {
    expect(isReportReason("other")).toBe(true);
    expect(isReportReason("whatever")).toBe(false);
  });
});
