import "@tanstack/react-start/server-only";

import {
  findSource,
  chapterUrlFor,
  twkanTocUrlFromReader,
  parseTwkanToc,
  biqugeTocUrlFromReader,
  parseBiqugeToc,
} from "@/lib/scrape";
import type { ScrapeProvider } from "@/lib/scrape.types";
import { fetchAndParse, fetchHtml } from "@/lib/scrape.server";
import {
  loadImportJob,
  markImportJobRunning,
  bumpImportJob,
  findChapterByNumber,
  insertRawChapter,
  markImportJobDone,
  markImportJobError,
} from "@/lib/scrape.job-store";
import { log } from "@/lib/log";

// Step logic for the "import-chapters" Inngest function. One step per chapter:
// fetch/parse failures count as `failed` and the run continues; DB errors
// propagate so Inngest retries the step instead of failing every chapter.

export async function initImportJob(jobId: string) {
  log("info", "Scrape worker step init", { jobId });
  const job = await loadImportJob(jobId);
  if (!job || job.status === "cancelled" || job.status === "done" || job.status === "error") {
    return { skip: true as const };
  }
  if (job.status === "pending") {
    await markImportJobRunning(jobId);
  }

  const source = findSource(job.baseUrl);
  let chapterUrls: Record<number, string> | undefined;
  const provider = (job.scrapeProvider as ScrapeProvider) ?? "auto";

  if (source.name === "twkan") {
    const tocUrl = twkanTocUrlFromReader(job.baseUrl);
    const tocHtml = await fetchHtml(tocUrl, provider);
    chapterUrls = parseTwkanToc(tocHtml, tocUrl);
  } else if (source.name === "biquge") {
    const tocUrl = biqugeTocUrlFromReader(job.baseUrl);
    const tocHtml = await fetchHtml(tocUrl, provider);
    chapterUrls = parseBiqugeToc(tocHtml, tocUrl);
  }

  return { skip: false as const, to: job.toNumber, next: job.nextNumber, chapterUrls };
}

export async function importOneChapter(
  jobId: string,
  n: number,
  chapterUrls?: Record<number, string>,
) {
  log("info", "Scrape worker step importOneChapter", { jobId, chapterNumber: n });
  const job = await loadImportJob(jobId);
  if (!job || job.status !== "running") return { stop: true as const };

  const source = findSource(job.baseUrl);

  // ponytail: fixed polite delay; twkan uses 1500ms to respect rate limit, others use 400ms.
  const delayMs = source.name === "twkan" ? 1500 : 400;
  await new Promise((r) => setTimeout(r, delayMs));

  const provider = (job.scrapeProvider as ScrapeProvider) ?? "auto";

  let targetUrl: string;
  if (source.name === "twkan" || source.name === "biquge") {
    const foundUrl = chapterUrls ? chapterUrls[n] : undefined;
    if (!foundUrl) {
      log("warn", "Scrape worker chapter import failed: missing URL in TOC", {
        jobId,
        chapterNumber: n,
      });
      await bumpImportJob(jobId, n + 1, {
        failed: job.failed + 1,
        error: `Chapter ${n} URL missing in TOC`,
      });
      return { stop: false as const, created: false };
    }
    targetUrl = foundUrl;
  } else {
    targetUrl = chapterUrlFor(job.baseUrl, n);
  }

  let scraped;
  try {
    scraped = await fetchAndParse(targetUrl, provider);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    log("warn", "Scrape worker chapter import failed", {
      jobId,
      chapterNumber: n,
      error: errorMsg,
    });
    await bumpImportJob(jobId, n + 1, {
      failed: job.failed + 1,
      error: errorMsg,
    });
    return { stop: false as const, created: false };
  }

  const existing = await findChapterByNumber(job.novelId, n.toString());

  if (existing) {
    await bumpImportJob(jobId, n + 1, { skipped: job.skipped + 1 });
    return { stop: false as const, created: false };
  }

  await insertRawChapter({
    novelId: job.novelId,
    number: n.toString(),
    title: scraped.title,
    content: scraped.content,
  });
  await bumpImportJob(jobId, n + 1, { added: job.added + 1 });
  return { stop: false as const, created: true };
}

export async function finishImportJob(jobId: string) {
  log("info", "Scrape worker step finish", { jobId });
  await markImportJobDone(jobId);
}

export async function failImportJob(jobId: string, message: string) {
  log("error", "Scrape worker step fail", { jobId, error: message });
  await markImportJobError(jobId, message);
}
