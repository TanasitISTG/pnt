import { describe, expect, it } from "vitest";

import {
  canRunJob,
  isCompletedChunk,
  isNextChunk,
  isSameTranslationRun,
  translationRunIdentity,
} from "./job-state";

const activeJob = {
  id: "job-1",
  status: "running",
  generation: 3,
  sourceRevision: 7,
  doneChunks: 2,
};

const activeChapter = {
  activeTranslationJobId: "job-1",
  translationGeneration: 3,
  sourceRevision: 7,
};

describe("translation job compatibility state", () => {
  it("allows only the active generation for the current source revision", () => {
    expect(canRunJob(activeJob, activeChapter, 3)).toBe(true);
  });

  it("rejects a superseded event generation", () => {
    expect(canRunJob(activeJob, activeChapter, 2)).toBe(false);
  });

  it("rejects a job after the chapter active pointer moves", () => {
    expect(canRunJob(activeJob, { ...activeChapter, activeTranslationJobId: "job-2" }, 3)).toBe(
      false,
    );
  });

  it("rejects a job created from an older source revision", () => {
    expect(canRunJob(activeJob, { ...activeChapter, sourceRevision: 8 }, 3)).toBe(false);
  });

  it("rejects terminal jobs", () => {
    expect(canRunJob({ ...activeJob, status: "cancelled" }, activeChapter, 3)).toBe(false);
    expect(canRunJob({ ...activeJob, status: "done" }, activeChapter, 3)).toBe(false);
  });

  it("matches cancellation to the exact job generation", () => {
    const cancelledRun = translationRunIdentity(activeJob);

    expect(isSameTranslationRun(cancelledRun, { jobId: "job-1", generation: 3 })).toBe(true);
    expect(isSameTranslationRun(cancelledRun, { jobId: "job-1", generation: 4 })).toBe(false);
  });

  it("distinguishes replayed chunks from the next legal chunk", () => {
    expect(isCompletedChunk(activeJob, 1)).toBe(true);
    expect(isCompletedChunk(activeJob, 2)).toBe(false);
    expect(isNextChunk(activeJob, 2)).toBe(true);
    expect(isNextChunk(activeJob, 3)).toBe(false);
  });
});
