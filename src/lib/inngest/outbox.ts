import "@tanstack/react-start/server-only";

import { and, asc, eq, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/async";
import { workflowOutbox } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { log } from "@/lib/log";

const OUTBOX_DISPATCH_CONCURRENCY = 2;

type SendOutboxEvent = (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;

const sendOutboxEvent: SendOutboxEvent = (event) => inngest.send(event as never);

export async function dispatchWorkflowOutboxEvent(
  outboxId: string,
  send: SendOutboxEvent = sendOutboxEvent,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(workflowOutbox)
    .where(
      and(
        eq(workflowOutbox.id, outboxId),
        eq(workflowOutbox.status, "pending"),
        lte(workflowOutbox.availableAt, sql`CURRENT_TIMESTAMP`),
      ),
    )
    .limit(1);

  if (!row) return false;

  try {
    const data = JSON.parse(row.payloadJson) as Record<string, unknown>;
    await send({ name: row.eventName, data });
    await db
      .update(workflowOutbox)
      .set({
        status: "sent",
        sentAt: sql`CURRENT_TIMESTAMP`,
        lastError: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(workflowOutbox.id, row.id), eq(workflowOutbox.status, "pending")));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const delayMs = Math.min(300_000, 5_000 * 2 ** Math.min(row.attempts, 6));
    await db
      .update(workflowOutbox)
      .set({
        attempts: sql`${workflowOutbox.attempts} + 1`,
        lastError: message.slice(0, 2000),
        availableAt: sql`CURRENT_TIMESTAMP + (${delayMs} * INTERVAL '1 millisecond')`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(workflowOutbox.id, row.id), eq(workflowOutbox.status, "pending")));
    log("warn", "Workflow outbox dispatch deferred", { outboxId, error: message });
    return false;
  }
}

export async function dispatchWorkflowOutboxEventBestEffort(outboxId: string): Promise<void> {
  try {
    await dispatchWorkflowOutboxEvent(outboxId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", "Workflow outbox eager dispatch failed; scheduled delivery will retry", {
      outboxId,
      error: message,
    });
  }
}

export async function dispatchPendingWorkflowOutbox(limit = 25) {
  const rows = await db
    .select({ id: workflowOutbox.id })
    .from(workflowOutbox)
    .where(
      and(
        eq(workflowOutbox.status, "pending"),
        lte(workflowOutbox.availableAt, sql`CURRENT_TIMESTAMP`),
      ),
    )
    .orderBy(asc(workflowOutbox.createdAt))
    .limit(limit);

  const results = await mapWithConcurrency(rows, OUTBOX_DISPATCH_CONCURRENCY, (row) =>
    dispatchWorkflowOutboxEvent(row.id),
  );
  const sent = results.reduce((count, wasSent) => count + Number(wasSent), 0);
  return { examined: rows.length, sent };
}
