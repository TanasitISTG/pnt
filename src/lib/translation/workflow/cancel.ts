import "@tanstack/react-start/server-only";

import { and, eq, sql } from "drizzle-orm";

import type { db } from "@/lib/db";
import { translationJobs, workflowOutbox } from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { appendLogEntry, createLog } from "./log-entry";

export type TranslationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TranslationCancellationCandidate {
  jobId: string;
  generation: number;
  logsJson?: string | null;
  message?: string;
}

export interface CancelledTranslationJob {
  jobId: string;
  generation: number;
}

export interface TranslationCancellationResult {
  cancelledJobs: CancelledTranslationJob[];
  outboxIds: string[];
}

export async function cancelActiveTranslationJobsInTransaction(
  tx: TranslationTransaction,
  candidates: readonly TranslationCancellationCandidate[],
  now = new Date(),
): Promise<TranslationCancellationResult> {
  const cancelledJobs: CancelledTranslationJob[] = [];
  const outboxRows: Array<{
    id: string;
    eventName: "translation/job.cancelled";
    payloadJson: string;
  }> = [];

  for (const candidate of candidates) {
    const [cancelled] = await tx
      .update(translationJobs)
      .set({
        status: "cancelled",
        logsJson: appendLogEntry(
          candidate.logsJson,
          createLog("warn", candidate.message ?? "Job cancelled by user."),
        ),
        updatedAt: now,
      })
      .where(
        and(
          eq(translationJobs.id, candidate.jobId),
          eq(translationJobs.generation, candidate.generation),
          sql`${translationJobs.status} IN ('pending', 'running')`,
        ),
      )
      .returning({ id: translationJobs.id, generation: translationJobs.generation });

    if (!cancelled) continue;

    cancelledJobs.push({ jobId: cancelled.id, generation: cancelled.generation });
    outboxRows.push({
      id: nanoid(),
      eventName: "translation/job.cancelled",
      payloadJson: JSON.stringify({ jobId: cancelled.id, generation: cancelled.generation }),
    });
  }

  if (outboxRows.length > 0) {
    await tx.insert(workflowOutbox).values(outboxRows);
  }

  return {
    cancelledJobs,
    outboxIds: outboxRows.map((row) => row.id),
  };
}
