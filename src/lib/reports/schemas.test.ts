import { describe, expect, it } from "vitest";

import {
  createCommentReportSchema,
  createNovelReportSchema,
  createReviewReportSchema,
  removeReportedTargetSchema,
  reportQueueInputSchema,
  reportQueueSearchSchema,
  resolveReportCaseSchema,
} from "@/lib/reports/schemas";
import {
  isReportReason,
  reportReasonKey,
  reportStatusKey,
  reportTargetKey,
} from "@/lib/reports/reasons";

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

describe("report schemas for the other targets", () => {
  it("applies the same reason-and-details rule to comments and reviews", () => {
    expect(
      createCommentReportSchema.safeParse({ commentId: "comment-1", reason: "other" }).success,
    ).toBe(false);
    expect(
      createReviewReportSchema.safeParse({
        reviewId: "review-1",
        reason: "other",
        details: "  A drive-by rating.  ",
      }).success,
    ).toBe(true);
    expect(
      createCommentReportSchema.parse({ commentId: "comment-1", reason: "spam_or_scam" }),
    ).toMatchObject({ commentId: "comment-1" });
  });

  it("requires a reason to remove reported content", () => {
    expect(
      removeReportedTargetSchema.safeParse({ caseKey: "comment-1", reason: "  " }).success,
    ).toBe(false);
    expect(
      removeReportedTargetSchema.parse({ caseKey: "comment-1", reason: "  Spoilers.  " }).reason,
    ).toBe("Spoilers.");
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

    expect(parsed).toEqual({ tab: "open", target: "all", q: "spam", page: 1, pageSize: 25 });
  });

  it("keeps a target filter and degrades an unknown one to every target", () => {
    expect(reportQueueInputSchema.parse({ target: "comment" }).target).toBe("comment");
    expect(reportQueueInputSchema.parse({ target: "nonsense" }).target).toBe("all");
  });

  it("keeps a valid tab and page", () => {
    expect(reportQueueSearchSchema.parse({ tab: "history", page: "2" })).toMatchObject({
      tab: "history",
      page: 2,
    });
  });
});

describe("report vocabulary", () => {
  it("names a catalog key for every known value", () => {
    // The words live in the catalog, so what this module owes its callers is the key: a
    // `reports.*` key for a stored value, and null for anything it does not know so the
    // caller can fall back to the raw one.
    expect(reportReasonKey("copyright")).toBe("reasonCopyright");
    expect(reportReasonKey("unknown")).toBeNull();
    expect(reportStatusKey("upheld")).toBe("statusUpheld");
    expect(reportStatusKey("unknown")).toBeNull();
  });

  it("recognizes only declared reasons", () => {
    expect(isReportReason("other")).toBe(true);
    expect(isReportReason("whatever")).toBe(false);
  });

  it("names every report target", () => {
    expect(reportTargetKey("novel")).toBe("targetNovel");
    expect(reportTargetKey("comment")).toBe("targetComment");
    expect(reportTargetKey("review")).toBe("targetReview");
    expect(reportTargetKey("unknown")).toBeNull();
  });
});
