import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  prepareEpubImportJob,
  initEpubImportJob,
  importOneEpubChapter,
  finishEpubImportJob,
  failEpubImportJob,
  cleanupExpiredEpubUploads,
} from "./worker";
import * as epubJobStore from "./job-store";
import * as importJobStore from "@/lib/import/job-store";
import * as epubParser from "./parser";

vi.mock("./job-store", () => ({
  loadEpubImportJob: vi.fn(),
  loadOrderedUploadChunks: vi.fn(),
  stageImportJobItems: vi.fn(),
  importOneStagedChapter: vi.fn(),
  markEpubImportJobDone: vi.fn(),
  markEpubImportJobError: vi.fn(),
  cleanupExpiredUploads: vi.fn(),
}));

vi.mock("@/lib/import/job-store", () => ({
  getMaxChapterNumber: vi.fn(),
  markImportJobRunning: vi.fn(),
}));

vi.mock("./parser", () => ({
  parseEpubArchive: vi.fn(),
}));

describe("EPUB worker steps", () => {
  const dummyJob = {
    id: "job-1",
    novelId: "novel-1",
    kind: "epub" as const,
    status: "pending" as const,
    baseUrl: "epub://upload-1",
    sourceFileName: "test.epub",
    epubUploadId: "upload-1",
    fromNumber: 1,
    toNumber: 0,
    nextNumber: 1,
    scrapeProvider: "epub",
    added: 0,
    skipped: 0,
    failed: 0,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("prepareEpubImportJob", () => {
    it("skips missing or terminal jobs", async () => {
      vi.mocked(epubJobStore.loadEpubImportJob).mockResolvedValueOnce(null as never);
      const res1 = await prepareEpubImportJob("job-missing");
      expect(res1).toEqual({ skip: true });

      vi.mocked(epubJobStore.loadEpubImportJob).mockResolvedValueOnce({
        ...dummyJob,
        status: "cancelled",
      } as never);
      const res2 = await prepareEpubImportJob("job-1");
      expect(res2).toEqual({ skip: true });
    });

    it("returns existing total if job is already prepared (idempotency)", async () => {
      vi.mocked(epubJobStore.loadEpubImportJob).mockResolvedValueOnce({
        ...dummyJob,
        toNumber: 50,
      } as never);

      const res = await prepareEpubImportJob("job-1");
      expect(res).toEqual({ skip: false, total: 50 });
      expect(epubJobStore.stageImportJobItems).not.toHaveBeenCalled();
    });

    it("concatenates chunks, parses EPUB, calculates fallback numbers, and stages items", async () => {
      vi.mocked(epubJobStore.loadEpubImportJob).mockResolvedValueOnce(dummyJob as never);
      vi.mocked(epubJobStore.loadOrderedUploadChunks).mockResolvedValueOnce([
        { chunkIndex: 0, data: Buffer.from([1, 2, 3]) },
        { chunkIndex: 1, data: Buffer.from([4, 5, 6]) },
      ]);
      vi.mocked(epubParser.parseEpubArchive).mockReturnValueOnce({
        metadata: { title: "Novel", author: "Author", language: "zh", description: null },
        chapters: [
          { number: null, title: "Unnumbered Chapter", content: "Content 1" },
          { number: "10", title: "Numbered Chapter", content: "Content 2" },
        ],
      });
      vi.mocked(importJobStore.getMaxChapterNumber).mockResolvedValueOnce(5);
      vi.mocked(epubJobStore.stageImportJobItems).mockResolvedValueOnce(2);

      const res = await prepareEpubImportJob("job-1");

      expect(res).toEqual({ skip: false, total: 2 });
      expect(epubJobStore.stageImportJobItems).toHaveBeenCalledWith("job-1", "upload-1", [
        {
          sequence: 1,
          chapterNumber: "11",
          title: "Unnumbered Chapter",
          rawContent: "Content 1",
          rawCharCount: 9,
        },
        {
          sequence: 2,
          chapterNumber: "10",
          title: "Numbered Chapter",
          rawContent: "Content 2",
          rawCharCount: 9,
        },
      ]);
    });

    it("rejects chapter numbers with more than two decimal places", async () => {
      vi.mocked(epubJobStore.loadEpubImportJob).mockResolvedValueOnce(dummyJob as never);
      vi.mocked(epubJobStore.loadOrderedUploadChunks).mockResolvedValueOnce([
        { chunkIndex: 0, data: Buffer.from([1]) },
      ]);
      vi.mocked(epubParser.parseEpubArchive).mockReturnValueOnce({
        metadata: { title: "Novel", author: null, language: null, description: null },
        chapters: [{ number: "1.234", title: "Invalid", content: "Content" }],
      });
      vi.mocked(importJobStore.getMaxChapterNumber).mockResolvedValueOnce(0);

      await expect(prepareEpubImportJob("job-1")).rejects.toThrow("Invalid chapter number");
      expect(epubJobStore.stageImportJobItems).not.toHaveBeenCalled();
    });
  });

  describe("initEpubImportJob", () => {
    it("skips missing or terminal jobs", async () => {
      vi.mocked(epubJobStore.loadEpubImportJob).mockResolvedValueOnce({
        ...dummyJob,
        status: "cancelled",
      } as never);
      const res = await initEpubImportJob("job-1");
      expect(res).toEqual({ skip: true });
    });

    it("marks pending jobs as running and returns cursor info", async () => {
      vi.mocked(epubJobStore.loadEpubImportJob).mockResolvedValueOnce({
        ...dummyJob,
        status: "pending",
        nextNumber: 1,
        toNumber: 10,
      } as never);

      const res = await initEpubImportJob("job-1");

      expect(res).toEqual({ skip: false, next: 1, to: 10 });
      expect(importJobStore.markImportJobRunning).toHaveBeenCalledWith("job-1");
    });
  });

  describe("importOneEpubChapter", () => {
    it("delegates to importOneStagedChapter", async () => {
      vi.mocked(epubJobStore.importOneStagedChapter).mockResolvedValueOnce({
        stop: false,
        action: "added",
      });

      const res = await importOneEpubChapter("job-1", 1);
      expect(res).toEqual({ stop: false, action: "added" });
      expect(epubJobStore.importOneStagedChapter).toHaveBeenCalledWith("job-1", 1);
    });
  });

  describe("finishEpubImportJob and failEpubImportJob", () => {
    it("finish marks job done and cleans staged data", async () => {
      await finishEpubImportJob("job-1");
      expect(epubJobStore.markEpubImportJobDone).toHaveBeenCalledWith("job-1");
    });

    it("fail marks job error and cleans staged data", async () => {
      await failEpubImportJob("job-1", "Parser failed");
      expect(epubJobStore.markEpubImportJobError).toHaveBeenCalledWith("job-1", "Parser failed");
    });
  });

  describe("cleanupExpiredEpubUploads", () => {
    it("calls cleanupExpiredUploads", async () => {
      vi.mocked(epubJobStore.cleanupExpiredUploads).mockResolvedValueOnce(3);
      const count = await cleanupExpiredEpubUploads();
      expect(count).toBe(3);
      expect(epubJobStore.cleanupExpiredUploads).toHaveBeenCalled();
    });
  });
});
