import "@tanstack/react-start/server-only";

import { and, asc, eq, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/async";
import { translationOutbox } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { log } from "@/lib/log";

const OUTBOX_DISPATCH_CONCURRENCY = 2;

type SendOutboxEvent = (event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;

const sendOutboxEvent: SendOutboxEvent = (event) => inngest.send(event as never);

export async function dispatchTranslationOutboxEvent(
  outboxId: string,
  send: SendOutboxEvent = sendOutboxEvent,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(translationOutbox)
    .where(
      and(
        eq(translationOutbox.id, outboxId),
        eq(translationOutbox.status, "pending"),
        lte(translationOutbox.availableAt, sql`CURRENT_TIMESTAMP`),
      ),
    )
    .limit(1);

  if (!row) return false;

  try {
    const data = JSON.parse(row.payloadJson) as Record<string, unknown>;
    await send({ name: row.eventName, data });
    await db
      .update(translationOutbox)
      .set({ status: "sent", sentAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(translationOutbox.id, row.id), eq(translationOutbox.status, "pending")));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const delayMs = Math.min(300_000, 5_000 * 2 ** Math.min(row.attempts, 6));
    await db
      .update(translationOutbox)
      .set({
        attempts: sql`${translationOutbox.attempts} + 1`,
        lastError: message.slice(0, 2000),
        availableAt: new Date(Date.now() + delayMs),
        updatedAt: new Date(),
      })
      .where(and(eq(translationOutbox.id, row.id), eq(translationOutbox.status, "pending")));
    log("warn", "Translation outbox dispatch deferred", { outboxId, error: message });
    return false;
  }
}

export async function dispatchTranslationOutboxEventBestEffort(outboxId: string): Promise<void> {
  try {
    await dispatchTranslationOutboxEvent(outboxId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", "Translation outbox eager dispatch failed; scheduled delivery will retry", {
      outboxId,
      error: message,
    });
  }
}

export async function dispatchPendingTranslationOutbox(limit = 25) {
  const rows = await db
    .select({ id: translationOutbox.id })
    .from(translationOutbox)
    .where(
      and(
        eq(translationOutbox.status, "pending"),
        lte(translationOutbox.availableAt, sql`CURRENT_TIMESTAMP`),
      ),
    )
    .orderBy(asc(translationOutbox.createdAt))
    .limit(limit);

  const results = await mapWithConcurrency(rows, OUTBOX_DISPATCH_CONCURRENCY, (row) =>
    dispatchTranslationOutboxEvent(row.id),
  );
  const sent = results.reduce((count, wasSent) => count + Number(wasSent), 0);
  return { examined: rows.length, sent };
}
