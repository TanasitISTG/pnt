import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  startImportJob,
  cancelImportJob,
  getImportJobStatus,
  getActiveImportJob,
} from "@/lib/scrape/functions";
import type { ScrapeProvider } from "@/lib/scrape/types";

export interface ImportJobState {
  id: string;
  kind?: "scrape" | "epub";
  status: string;
  sourceFileName?: string | null;
  fromNumber: number;
  toNumber: number;
  nextNumber: number;
  added: number;
  skipped: number;
  failed: number;
  error: string | null;
}

type ScrapeImportRequest = {
  baseUrl: string;
  from: number;
  to: number;
  provider: ScrapeProvider;
};

export function useImportJob(
  novelId: string,
  invalidateChapters: () => void,
  kind: "scrape" | "epub" = "scrape",
) {
  const [importJob, setImportJob] = useState<ImportJobState | null>(null);
  const [importStatusError, setImportStatusError] = useState<Error | null>(null);
  const [lastScrapeRequest, setLastScrapeRequest] = useState<ScrapeImportRequest | null>(null);
  const importActive = importJob?.status === "pending" || importJob?.status === "running";

  // Re-attach to a running import after refresh
  useEffect(() => {
    let cancelled = false;
    getActiveImportJob({ data: { novelId, kind } })
      .then((job) => {
        if (!cancelled) {
          setImportStatusError(null);
          if (job) setImportJob(job);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setImportStatusError(
            error instanceof Error ? error : new Error("Unable to load import status"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [novelId, kind]);

  // Poll active import job (read-only, idempotent)
  useEffect(() => {
    if (!importJob || !importActive) return;
    const interval = setInterval(async () => {
      if (document.hidden) return;
      try {
        const res = await getImportJobStatus({ data: { jobId: importJob.id } });
        if (!res) {
          setImportJob(null);
          return;
        }
        setImportStatusError(null);
        setImportJob(res);
        if (res.status === "done") {
          invalidateChapters();
          toast.success(
            `Import done: added ${res.added}, skipped ${res.skipped}, failed ${res.failed}`,
          );
        } else if (res.status === "error") {
          invalidateChapters();
          toast.error(`Import failed: ${res.error || "Unknown error"}`);
        } else if (res.status === "cancelled") {
          invalidateChapters();
          toast.info("Import cancelled");
        }
      } catch (error: unknown) {
        setImportStatusError(
          error instanceof Error ? error : new Error("Unable to refresh import status"),
        );
      }
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importJob?.id, importActive, invalidateChapters]);

  const startImport = async (
    baseUrl: string,
    from: number,
    to: number,
    provider: ScrapeProvider,
  ) => {
    try {
      const { jobId } = await startImportJob({
        data: { novelId, baseUrl, from, to, provider },
      });
      setImportJob({
        id: jobId,
        kind,
        status: "pending",
        sourceFileName: null,
        fromNumber: from,
        toNumber: to,
        nextNumber: from,
        added: 0,
        skipped: 0,
        failed: 0,
        error: null,
      });
      setLastScrapeRequest({ baseUrl, from, to, provider });
      setImportStatusError(null);
      toast.info(`Import of chapters ${from}–${to} queued`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start import");
    }
  };

  const cancelImport = async () => {
    if (!importJob) return;
    try {
      await cancelImportJob({ data: { jobId: importJob.id } });
      setImportJob((j) => (j ? { ...j, status: "cancelled" } : j));
      invalidateChapters();
      toast.info("Import cancelled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel import");
    }
  };
  const attachJob = (jobId: string, sourceFileName?: string) => {
    setImportJob({
      id: jobId,
      kind,
      status: "pending",
      sourceFileName: sourceFileName ?? null,
      fromNumber: 1,
      toNumber: 0,
      nextNumber: 1,
      added: 0,
      skipped: 0,
      failed: 0,
      error: null,
    });
    setImportStatusError(null);
  };
  const retryImportStatus = async () => {
    if (!importJob) return;
    try {
      const res = await getImportJobStatus({ data: { jobId: importJob.id } });
      setImportStatusError(null);
      setImportJob(res);
      if (!res) invalidateChapters();
    } catch (error: unknown) {
      setImportStatusError(
        error instanceof Error ? error : new Error("Unable to refresh import status"),
      );
    }
  };

  const retryImport = async () => {
    if (kind !== "scrape" || !lastScrapeRequest) return;
    await startImport(
      lastScrapeRequest.baseUrl,
      lastScrapeRequest.from,
      lastScrapeRequest.to,
      lastScrapeRequest.provider,
    );
  };

  return {
    importJob,
    importActive,
    startImport,
    cancelImport,
    attachJob,
    importStatusError,
    retryImportStatus,
    canRetryImport: kind === "scrape" && lastScrapeRequest !== null,
    retryImport,
  };
}
