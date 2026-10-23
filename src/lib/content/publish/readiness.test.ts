import { describe, expect, it } from "vitest";

import { encodeMessage } from "@/lib/i18n/message-code";
import {
  evaluatePublication,
  evaluatePublicationText,
  paragraphCount,
  publicationBlockMessage,
  publicationRevisionOf,
  type PublicationFacts,
} from "./readiness";

const COMPLETE_RUN = { id: "job-1", status: "done", doneChunks: 3, totalChunks: 3 };
const COMPLETE_CHUNKS = { total: 3, unusable: 0 };

function facts(overrides: Partial<PublicationFacts> = {}): PublicationFacts {
  return {
    status: "translated",
    hasBody: true,
    activeTranslationJobId: null,
    rawParagraphs: 4,
    translatedParagraphs: 4,
    run: COMPLETE_RUN,
    chunks: COMPLETE_CHUNKS,
    ...overrides,
  };
}

describe("evaluatePublication", () => {
  it("allows a chapter whose run and chunks are complete", () => {
    expect(evaluatePublication(facts())).toEqual({ publishable: true, blockers: [] });
  });

  it("allows a translation that gained paragraph breaks", () => {
    expect(evaluatePublication(facts({ translatedParagraphs: 6 }))).toEqual({
      publishable: true,
      blockers: [],
    });
  });

  it("refuses an untranslated chapter, and reads nothing else about it", () => {
    expect(
      evaluatePublication(facts({ status: "raw", hasBody: false, run: null, chunks: null })),
    ).toEqual({ publishable: false, blockers: [{ reason: "translation-missing" }] });
  });

  it("refuses a translated status whose body is blank", () => {
    expect(evaluatePublication(facts({ hasBody: false }))).toEqual({
      publishable: false,
      blockers: [{ reason: "translation-missing" }],
    });
  });

  it("refuses a chapter a run still owns, and says nothing about the older text", () => {
    expect(
      evaluatePublication(
        facts({ activeTranslationJobId: "job-2", run: { ...COMPLETE_RUN, status: "error" } }),
      ),
    ).toEqual({ publishable: false, blockers: [{ reason: "translation-in-flight" }] });
  });

  it("refuses a run that never finished", () => {
    expect(evaluatePublication(facts({ run: { ...COMPLETE_RUN, doneChunks: 2 } }))).toEqual({
      publishable: false,
      blockers: [{ reason: "run-incomplete", jobId: "job-1" }],
    });
    expect(evaluatePublication(facts({ run: { ...COMPLETE_RUN, status: "pending" } }))).toEqual({
      publishable: false,
      blockers: [{ reason: "run-incomplete", jobId: "job-1" }],
    });
  });

  it("counts unusable and absent chunk rows as one blocker", () => {
    expect(evaluatePublication(facts({ chunks: { total: 3, unusable: 1 } }))).toEqual({
      publishable: false,
      blockers: [{ reason: "chunk-failed", jobId: "job-1", failedChunks: 1 }],
    });
    expect(evaluatePublication(facts({ chunks: { total: 3, unusable: 2 } }))).toEqual({
      publishable: false,
      blockers: [{ reason: "chunk-failed", jobId: "job-1", failedChunks: 2 }],
    });
    expect(evaluatePublication(facts({ chunks: { total: 1, unusable: 0 } }))).toEqual({
      publishable: false,
      blockers: [{ reason: "chunk-failed", jobId: "job-1", failedChunks: 2 }],
    });
  });

  it("refuses a translation that lost a paragraph break", () => {
    expect(evaluatePublication(facts({ translatedParagraphs: 3 }))).toEqual({
      publishable: false,
      blockers: [{ reason: "missing-paragraphs", missingParagraphs: 1 }],
    });
  });

  it("reports every blocker it finds, in one order", () => {
    expect(
      evaluatePublication(
        facts({
          run: { ...COMPLETE_RUN, doneChunks: 1 },
          chunks: { total: 1, unusable: 1 },
          translatedParagraphs: 2,
        }),
      ),
    ).toEqual({
      publishable: false,
      blockers: [
        { reason: "run-incomplete", jobId: "job-1" },
        { reason: "missing-paragraphs", missingParagraphs: 2 },
      ],
    });
  });

  it("does not require a run: a hand-written translation is judged on its paragraphs", () => {
    expect(evaluatePublication(facts({ run: null, chunks: null }))).toEqual({
      publishable: true,
      blockers: [],
    });
    expect(
      evaluatePublication(facts({ run: null, chunks: null, translatedParagraphs: 1 })),
    ).toEqual({
      publishable: false,
      blockers: [{ reason: "missing-paragraphs", missingParagraphs: 3 }],
    });
  });

  it("has no input for a quality warning, so a flagged chapter still publishes", () => {
    // Residual source-script spans and glossary misses live in the evaluation report; a
    // complete chapter passes here whatever that report says, and that is the point.
    const flagged = facts();
    expect(Object.keys(flagged)).not.toContain("residualScriptLetters");
    expect(evaluatePublication(flagged).publishable).toBe(true);
  });
});

describe("text-level checks", () => {
  it("counts blank-line paragraphs, the structure the pipeline preserves", () => {
    expect(paragraphCount("one\n\ntwo\n\nthree")).toBe(3);
    expect(paragraphCount("one \n \ntwo")).toBe(2);
    expect(paragraphCount("   ")).toBe(0);
    expect(paragraphCount(null)).toBe(0);
    // A soft line break is layout, not a paragraph: the worker never asks a translation to
    // carry it, so a source that uses one is a single paragraph on both sides.
    expect(paragraphCount("one\ntwo")).toBe(1);
    expect(evaluatePublicationText("one\ntwo", "หนึ่ง\nสอง")).toBeNull();
  });

  it("withholds a scheduled chapter whose saved text lost a break", () => {
    expect(evaluatePublicationText("a\n\nb\n\nc", "ก\n\nข")).toEqual({
      reason: "missing-paragraphs",
      missingParagraphs: 1,
    });
    expect(evaluatePublicationText("a\n\nb", "ก\n\nข")).toBeNull();
  });
});

describe("publicationBlockMessage", () => {
  it("names the code and the count each refusal needs", () => {
    expect(publicationBlockMessage({ reason: "translation-in-flight" })).toBe(
      encodeMessage("errors.chapterPublishBlockedInFlight"),
    );
    expect(publicationBlockMessage({ reason: "run-incomplete", jobId: "job-1" })).toBe(
      encodeMessage("errors.chapterPublishBlockedIncomplete"),
    );
    expect(publicationBlockMessage({ reason: "chunk-failed", failedChunks: 2 })).toBe(
      encodeMessage("errors.chapterPublishBlockedChunkFailed", { count: 2 }),
    );
    expect(publicationBlockMessage({ reason: "missing-paragraphs", missingParagraphs: 1 })).toBe(
      encodeMessage("errors.chapterPublishBlockedMissingParagraphs", { count: 1 }),
    );
    expect(publicationBlockMessage({ reason: "translation-missing" })).toBe(
      encodeMessage("errors.chapterNotTranslatedForPublish"),
    );
  });
});

describe("publicationRevisionOf", () => {
  it("moves with the translated count and the newest chapter write", () => {
    const first = publicationRevisionOf([
      { status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(
      publicationRevisionOf([{ status: "translated", updatedAt: "2026-01-02T00:00:00.000Z" }]),
    ).not.toBe(first);
    expect(
      publicationRevisionOf([
        { status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" },
        { status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" },
      ]),
    ).not.toBe(first);
  });

  it("ignores a draft's timestamp", () => {
    expect(
      publicationRevisionOf([
        { status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" },
        { status: "raw", updatedAt: "2026-09-09T00:00:00.000Z" },
      ]),
    ).toBe(
      publicationRevisionOf([{ status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" }]),
    );
  });
});
