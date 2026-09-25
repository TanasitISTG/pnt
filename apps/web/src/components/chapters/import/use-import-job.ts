import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  cancelImportJob,
  getActiveImportJob,
  getImportJobStatus,
  getLatestImportJob,
  startImportJob,
} from "@/lib/scrape/functions";
import { invalidateJobDashboard } from "@/lib/job-dashboard/query";
import type { JobHistoryStatus } from "@/lib/job-dashboard/contracts";
import type { ScrapeProvider } from "@/lib/scrape/types";

export type ImportJobKind = "scrape" | "epub";

export interface ImportJobState {
  id: string;
  kind: ImportJobKind;
  status: JobHistoryStatus;
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

export interface ImportJobController {
  importJob: ImportJobState | null;
  importActive: boolean;
  initialStatusLoading: boolean;
  startPending: boolean;
  startImport: (
    baseUrl: string,
    from: number,
    to: number,
    provider: ScrapeProvider,
  ) => Promise<void>;
  cancelImport: () => Promise<void>;
  attachJob: (jobId: string, sourceFileName?: string) => void;
  importStatusError: Error | null;
  retryImportStatus: () => Promise<void>;
  canRetryImport: boolean;
  retryImport: () => Promise<void>;
}

const POLL_DELAY_MS = 2_000;

function isActiveStatus(status: JobHistoryStatus): boolean {
  return status === "pending" || status === "running";
}

function isTerminalStatus(status: JobHistoryStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isRecoverableInitialJob(
  job: ImportJobState | null,
  kind: ImportJobKind,
): ImportJobState | null {
  if (!job) return null;
  if (
    kind === "epub" &&
    !isActiveStatus(job.status) &&
    job.status !== "error" &&
    job.status !== "cancelled"
  ) {
    return null;
  }
  return job;
}

/**
 * Accept a status response only if it cannot move a job backwards. A terminal
 * response is authoritative for this local job identity; an older poll must
 * not make it look active again.
 */
function canApplyStatus(current: ImportJobState | null, next: ImportJobState | null): boolean {
  if (!current || !next) return true;
  if (current.id !== next.id) return false;
  if (isTerminalStatus(current.status)) return current.status === next.status;
  return true;
}

export function useImportJob(
  novelId: string,
  invalidateChapters: () => void,
  kind: ImportJobKind = "scrape",
): ImportJobController {
  const queryClient = useQueryClient();
  const [importJob, setImportJob] = useState<ImportJobState | null>(null);
  const [importStatusError, setImportStatusError] = useState<Error | null>(null);
  const [initialStatusLoading, setInitialStatusLoading] = useState(true);
  const [startPending, setStartPending] = useState(false);
  const [lastScrapeRequest, setLastScrapeRequest] = useState<ScrapeImportRequest | null>(null);
  const [jobVersion, setJobVersion] = useState(0);

  // Refs are the synchronous source of truth for event handlers and in-flight
  // requests. React state alone cannot prevent two clicks in one render from
  // entering the same async operation.
  const importJobRef = useRef<ImportJobState | null>(null);
  const invalidateChaptersRef = useRef(invalidateChapters);
  const localRevisionRef = useRef(0);
  const jobVersionRef = useRef(0);
  const initialRequestRef = useRef(0);
  const initialStatusLoadingRef = useRef(true);
  const startPendingRef = useRef(false);
  const startTokenRef = useRef<number | null>(null);
  const cancelPendingRef = useRef(false);
  const cancelTokenRef = useRef<number | null>(null);
  const lastScrapeRequestRef = useRef<ScrapeImportRequest | null>(null);
  const statusRequestRef = useRef(0);
  const statusRequestInFlightRef = useRef(false);
  const pollRunRef = useRef(0);

  useEffect(() => {
    invalidateChaptersRef.current = invalidateChapters;
  }, [invalidateChapters]);

  const setInitialLoading = (loading: boolean) => {
    initialStatusLoadingRef.current = loading;
    setInitialStatusLoading(loading);
  };

  const markLocalMutation = (): number => {
    const revision = localRevisionRef.current + 1;
    localRevisionRef.current = revision;
    jobVersionRef.current = revision;
    setJobVersion(revision);
    // Local operations invalidate any response that started before them.
    // Discovery remains marked as loading until its request actually settles,
    // so the parent cannot start another bulk operation prematurely.
    setImportStatusError(null);
    return revision;
  };

  const applyRemoteJob = (next: ImportJobState | null): boolean => {
    const current = importJobRef.current;
    if (!canApplyStatus(current, next)) return false;
    importJobRef.current = next;
    setImportJob(next);
    return true;
  };

  // Re-attach after refresh. EPUB intentionally asks for the latest row,
  // rather than filtering to active rows in SQL: a newer completed row must
  // hide an older failed/cancelled row.
  useEffect(() => {
    const requestId = initialRequestRef.current + 1;
    initialRequestRef.current = requestId;
    const revision = localRevisionRef.current + 1;
    localRevisionRef.current = revision;
    jobVersionRef.current = revision;
    setJobVersion(revision);
    importJobRef.current = null;
    setImportJob(null);
    lastScrapeRequestRef.current = null;
    setLastScrapeRequest(null);
    setImportStatusError(null);
    setInitialLoading(true);

    let cancelled = false;
    const expectedRevision = localRevisionRef.current;

    const request =
      kind === "epub"
        ? getLatestImportJob({ data: { novelId, kind } })
        : getActiveImportJob({ data: { novelId, kind } });

    request
      .then((job) => {
        if (
          cancelled ||
          requestId !== initialRequestRef.current ||
          expectedRevision !== localRevisionRef.current ||
          importJobRef.current !== null
        ) {
          return;
        }
        applyRemoteJob(isRecoverableInitialJob(job, kind));
        setImportStatusError(null);
      })
      .catch((error: unknown) => {
        if (
          cancelled ||
          requestId !== initialRequestRef.current ||
          expectedRevision !== localRevisionRef.current ||
          importJobRef.current !== null
        ) {
          return;
        }
        setImportStatusError(normalizeError(error, "Unable to load import status"));
      })
      .finally(() => {
        if (
          !cancelled &&
          requestId === initialRequestRef.current &&
          expectedRevision === localRevisionRef.current &&
          importJobRef.current === null
        ) {
          setInitialLoading(false);
        } else if (!cancelled && requestId === initialRequestRef.current) {
          // A local attach/start won while discovery was pending.
          setInitialLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [novelId, kind]);

  const polledJobId = importJob?.id;
  const polledJobStatus = importJob?.status;

  // Each tick claims a shared in-flight slot before reading status. This
  // preserves response order while the job version rejects stale job results.
  useEffect(() => {
    if (!polledJobId || !polledJobStatus || !isActiveStatus(polledJobStatus)) return;

    const jobId = polledJobId;
    const version = jobVersion;
    const pollRun = pollRunRef.current + 1;
    pollRunRef.current = pollRun;
    let cancelled = false;

    async function poll(): Promise<void> {
      if (cancelled || pollRun !== pollRunRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      // Manual refreshes and earlier ticks share this slot, so status reads
      // cannot overlap or settle out of order.
      if (statusRequestInFlightRef.current) return;

      const requestId = statusRequestRef.current + 1;
      statusRequestRef.current = requestId;
      statusRequestInFlightRef.current = true;

      try {
        const result = await getImportJobStatus({ data: { jobId } });
        if (
          cancelled ||
          pollRun !== pollRunRef.current ||
          requestId !== statusRequestRef.current ||
          version !== jobVersionRef.current ||
          importJobRef.current?.id !== jobId
        ) {
          return;
        }

        if (!result) {
          applyRemoteJob(null);
          invalidateChaptersRef.current();
          void invalidateJobDashboard(queryClient);
          return;
        }

        const previous = importJobRef.current;
        if (!canApplyStatus(previous, result)) return;
        importJobRef.current = result;
        setImportJob(result);
        setImportStatusError(null);

        if (isTerminalStatus(result.status)) {
          invalidateChaptersRef.current();
          void invalidateJobDashboard(queryClient);
        }
        if (result.status === "done") {
          toast.success(
            `Import done: added ${result.added}, skipped ${result.skipped}, failed ${result.failed}`,
          );
        } else if (result.status === "error") {
          toast.error(`Import failed: ${result.error || "Unknown error"}`);
        } else if (result.status === "cancelled") {
          toast.info("Import cancelled");
        }
      } catch (error: unknown) {
        if (
          !cancelled &&
          pollRun === pollRunRef.current &&
          requestId === statusRequestRef.current &&
          version === jobVersionRef.current &&
          importJobRef.current?.id === jobId
        ) {
          setImportStatusError(normalizeError(error, "Unable to refresh import status"));
        }
      } finally {
        if (requestId === statusRequestRef.current) {
          statusRequestInFlightRef.current = false;
        }
      }
    }

    const interval = setInterval(() => void poll(), POLL_DELAY_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (pollRun === pollRunRef.current) pollRunRef.current += 1;
    };
  }, [polledJobId, polledJobStatus, jobVersion, queryClient]);

  const startImport = async (
    baseUrl: string,
    from: number,
    to: number,
    provider: ScrapeProvider,
  ): Promise<void> => {
    if (
      kind !== "scrape" ||
      startPendingRef.current ||
      initialStatusLoadingRef.current ||
      (importJobRef.current !== null && isActiveStatus(importJobRef.current.status))
    ) {
      return;
    }

    const revision = markLocalMutation();
    startPendingRef.current = true;
    startTokenRef.current = revision;
    setStartPending(true);

    try {
      const { jobId } = await startImportJob({
        data: { novelId, baseUrl, from, to, provider },
      });
      if (revision !== localRevisionRef.current) return;

      const nextJob: ImportJobState = {
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
      };
      importJobRef.current = nextJob;
      setImportJob(nextJob);
      const request = { baseUrl, from, to, provider };
      lastScrapeRequestRef.current = request;
      setLastScrapeRequest(request);
      setImportStatusError(null);
      void invalidateJobDashboard(queryClient);
      toast.info(`Import of chapters ${from}–${to} queued`);
    } catch (error: unknown) {
      if (revision === localRevisionRef.current) {
        toast.error(normalizeError(error, "Failed to start import").message);
      }
    } finally {
      if (startTokenRef.current === revision) {
        startPendingRef.current = false;
        startTokenRef.current = null;
        setStartPending(false);
      }
    }
  };

  const cancelImport = async (): Promise<void> => {
    const current = importJobRef.current;
    if (
      !current ||
      !isActiveStatus(current.status) ||
      cancelPendingRef.current ||
      startPendingRef.current
    ) {
      return;
    }

    const revision = markLocalMutation();
    cancelPendingRef.current = true;
    cancelTokenRef.current = revision;
    const jobId = current.id;

    try {
      await cancelImportJob({ data: { jobId } });
      const currentJob = importJobRef.current;
      if (revision !== localRevisionRef.current || currentJob?.id !== jobId || !currentJob) {
        return;
      }
      const cancelledJob: ImportJobState = { ...currentJob, status: "cancelled" };
      importJobRef.current = cancelledJob;
      setImportJob(cancelledJob);
      invalidateChaptersRef.current();
      void invalidateJobDashboard(queryClient);
      toast.info("Import cancelled");
    } catch (error: unknown) {
      if (revision === localRevisionRef.current && importJobRef.current?.id === jobId) {
        toast.error(normalizeError(error, "Failed to cancel import").message);
      }
    } finally {
      if (cancelTokenRef.current === revision) {
        cancelPendingRef.current = false;
        cancelTokenRef.current = null;
      }
    }
  };

  const attachJob = (jobId: string, sourceFileName?: string): void => {
    const revision = markLocalMutation();
    const nextJob: ImportJobState = {
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
    };
    // Keep the revision read above meaningful to future in-flight operations.
    if (revision === localRevisionRef.current) {
      importJobRef.current = nextJob;
      setImportJob(nextJob);
      setImportStatusError(null);
      // A locally attached active import changes the global dashboard counts.
      void invalidateJobDashboard(queryClient);
    }
  };

  const beginStatusRequest = (): number | null => {
    if (statusRequestInFlightRef.current) return null;
    const requestId = statusRequestRef.current + 1;
    statusRequestRef.current = requestId;
    statusRequestInFlightRef.current = true;
    return requestId;
  };

  const retryImportStatus = async (): Promise<void> => {
    const requestId = beginStatusRequest();
    if (requestId === null) return;

    const expectedRevision = localRevisionRef.current;
    const expectedJobId = importJobRef.current?.id ?? null;
    const currentJob = importJobRef.current;

    try {
      const result = currentJob
        ? await getImportJobStatus({ data: { jobId: currentJob.id } })
        : await (kind === "epub"
            ? getLatestImportJob({ data: { novelId, kind } })
            : getActiveImportJob({ data: { novelId, kind } }));

      if (
        requestId !== statusRequestRef.current ||
        expectedRevision !== localRevisionRef.current ||
        expectedJobId !== (importJobRef.current?.id ?? null)
      ) {
        return;
      }

      const nextJob = currentJob ? result : isRecoverableInitialJob(result, kind);
      if (!canApplyStatus(importJobRef.current, nextJob)) return;
      importJobRef.current = nextJob;
      setImportJob(nextJob);
      setImportStatusError(null);
      // A manual refresh that discovers a terminal result (or a removed job)
      // must update the dashboard exactly like polled completion does.
      if (!nextJob || isTerminalStatus(nextJob.status)) {
        invalidateChaptersRef.current();
        void invalidateJobDashboard(queryClient);
      }
    } catch (error: unknown) {
      if (
        requestId === statusRequestRef.current &&
        expectedRevision === localRevisionRef.current &&
        expectedJobId === (importJobRef.current?.id ?? null)
      ) {
        setImportStatusError(normalizeError(error, "Unable to refresh import status"));
      }
    } finally {
      if (requestId === statusRequestRef.current) {
        statusRequestInFlightRef.current = false;
      }
    }
  };

  const retryImport = async (): Promise<void> => {
    const request = lastScrapeRequestRef.current;
    if (kind !== "scrape" || !request) return;
    await startImport(request.baseUrl, request.from, request.to, request.provider);
  };

  const importActive = importJob ? isActiveStatus(importJob.status) : false;

  return {
    importJob,
    importActive,
    initialStatusLoading,
    startPending,
    startImport,
    cancelImport,
    attachJob,
    importStatusError,
    retryImportStatus,
    canRetryImport: kind === "scrape" && lastScrapeRequest !== null,
    retryImport,
  };
}
