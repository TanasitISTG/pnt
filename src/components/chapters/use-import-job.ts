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

export function useImportJob(
  novelId: string,
  invalidateChapters: () => void,
  kind: "scrape" | "epub" = "scrape",
) {
  const [importJob, setImportJob] = useState<ImportJobState | null>(null);
  const importActive = importJob?.status === "pending" || importJob?.status === "running";

  // Re-attach to a running import after refresh
  useEffect(() => {
    let cancelled = false;
    getActiveImportJob({ data: { novelId, kind } })
      .then((job) => {
        if (!cancelled && job) setImportJob(job);
      })
      .catch(() => {});
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
      } catch {
        // Transient read failure — next poll retries.
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
  };

  return { importJob, importActive, startImport, cancelImport, attachJob };
}
