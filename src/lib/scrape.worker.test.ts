import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { initImportJob, importOneChapter } from "./scrape.worker";
import * as jobStore from "./scrape.job-store";
import * as scrapeServer from "./scrape.server";

vi.mock("./scrape.job-store", () => ({
  loadImportJob: vi.fn(),
  markImportJobRunning: vi.fn(),
  bumpImportJob: vi.fn(),
  findChapterByNumber: vi.fn(),
  insertRawChapter: vi.fn(),
  markImportJobDone: vi.fn(),
  markImportJobError: vi.fn(),
}));

vi.mock("./scrape.server", () => ({
  fetchAndParse: vi.fn(),
  fetchHtml: vi.fn(),
}));

// Keep the real scrape.ts pure functions (findSource, chapterUrlFor,
// twkanTocUrlFromReader) — only the TOC parsers are stubbed so init tests
// don't depend on site fixtures.
vi.mock("./scrape", async (importActual) => {
  const actual = await importActual<typeof import("./scrape")>();
  return {
    ...actual,
    parseTwkanToc: vi.fn().mockReturnValue({ 5: "https://twkan.com/txt/123/5.html" }),
  };
});

describe("scrape worker steps", () => {
  const quanbenJob = {
    id: "job-1",
    novelId: "novel-1",
    status: "running",
    baseUrl: "https://www.quanben.io/n/abc/1.html",
    fromNumber: 1,
    toNumber: 10,
    nextNumber: 5,
    scrapeProvider: "auto",
    added: 0,
    skipped: 0,
    failed: 0,
    error: null,
  };

  const twkanJob = {
    ...quanbenJob,
    baseUrl: "https://twkan.com/txt/123/456.html",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runChapter(n: number, chapterUrls?: Record<number, string>) {
    // importOneChapter sleeps a polite per-site delay before fetching —
    // flush it via fake timers (400ms quanben / 1500ms twkan, advance past both).
    const p = importOneChapter("job-1", n, chapterUrls);
    await vi.advanceTimersByTimeAsync(1600);
    return p;
  }

  it("1. initImportJob skips when the job row is gone", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue(null as never);

    const res = await initImportJob("job-1");

    expect(res).toEqual({ skip: true });
    expect(jobStore.markImportJobRunning).not.toHaveBeenCalled();
  });

  it("2. initImportJob skips terminal jobs without touching status", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue({
      ...quanbenJob,
      status: "cancelled",
    } as never);

    const res = await initImportJob("job-1");

    expect(res).toEqual({ skip: true });
    expect(jobStore.markImportJobRunning).not.toHaveBeenCalled();
  });

  it("3. initImportJob marks pending jobs running; quanben needs no TOC", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue({
      ...quanbenJob,
      status: "pending",
    } as never);

    const res = await initImportJob("job-1");

    expect(jobStore.markImportJobRunning).toHaveBeenCalledWith("job-1");
    expect(scrapeServer.fetchHtml).not.toHaveBeenCalled();
    expect(res).toEqual({ skip: false, to: 10, next: 5, chapterUrls: undefined });
  });

  it("4. initImportJob resolves the TOC for twkan jobs", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue(twkanJob as never);
    vi.mocked(scrapeServer.fetchHtml).mockResolvedValue("<html>toc</html>");

    const res = await initImportJob("job-1");

    expect(scrapeServer.fetchHtml).toHaveBeenCalledWith("https://twkan.com/book/123.html", "auto");
    expect(res).toEqual({
      skip: false,
      to: 10,
      next: 5,
      chapterUrls: { 5: "https://twkan.com/txt/123/5.html" },
    });
  });

  it("5. importOneChapter stops when the job is no longer running", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue({
      ...quanbenJob,
      status: "cancelled",
    } as never);

    const res = await runChapter(5);

    expect(res).toEqual({ stop: true });
    expect(scrapeServer.fetchAndParse).not.toHaveBeenCalled();
  });

  it("6. importOneChapter counts scrape errors as failed and continues", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue(quanbenJob as never);
    vi.mocked(scrapeServer.fetchAndParse).mockRejectedValue(new Error("boom"));

    const res = await runChapter(5);

    expect(res).toEqual({ stop: false, created: false });
    expect(scrapeServer.fetchAndParse).toHaveBeenCalledWith(
      "https://www.quanben.io/n/abc/5.html",
      "auto",
    );
    expect(jobStore.bumpImportJob).toHaveBeenCalledWith(
      "job-1",
      6,
      expect.objectContaining({ failed: 1, error: "boom" }),
    );
    expect(jobStore.insertRawChapter).not.toHaveBeenCalled();
  });

  it("7. importOneChapter skips chapters that already exist", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue(quanbenJob as never);
    vi.mocked(scrapeServer.fetchAndParse).mockResolvedValue({
      number: 5,
      title: "Chapter 5",
      content: "Some content",
      nextUrl: null,
    });
    vi.mocked(jobStore.findChapterByNumber).mockResolvedValue({ id: "chapter-1" } as never);

    const res = await runChapter(5);

    expect(res).toEqual({ stop: false, created: false });
    expect(jobStore.bumpImportJob).toHaveBeenCalledWith(
      "job-1",
      6,
      expect.objectContaining({ skipped: 1 }),
    );
    expect(jobStore.insertRawChapter).not.toHaveBeenCalled();
  });

  it("8. importOneChapter inserts scraped chapters and advances the cursor", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue(quanbenJob as never);
    vi.mocked(scrapeServer.fetchAndParse).mockResolvedValue({
      number: 5,
      title: "Chapter 5",
      content: "Some content",
      nextUrl: null,
    });
    vi.mocked(jobStore.findChapterByNumber).mockResolvedValue(null as never);

    const res = await runChapter(5);

    expect(res).toEqual({ stop: false, created: true });
    expect(jobStore.insertRawChapter).toHaveBeenCalledWith({
      novelId: "novel-1",
      number: "5",
      title: "Chapter 5",
      content: "Some content",
    });
    expect(jobStore.bumpImportJob).toHaveBeenCalledWith(
      "job-1",
      6,
      expect.objectContaining({ added: 1 }),
    );
  });

  it("9. importOneChapter fails fast when a twkan chapter URL is missing from the TOC", async () => {
    vi.mocked(jobStore.loadImportJob).mockResolvedValue(twkanJob as never);

    const res = await runChapter(7, { 5: "https://twkan.com/txt/123/5.html" });

    expect(res).toEqual({ stop: false, created: false });
    expect(scrapeServer.fetchAndParse).not.toHaveBeenCalled();
    expect(jobStore.bumpImportJob).toHaveBeenCalledWith(
      "job-1",
      8,
      expect.objectContaining({ failed: 1, error: "Chapter 7 URL missing in TOC" }),
    );
  });
});
