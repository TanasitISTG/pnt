import "@tanstack/react-start/server-only";

import * as Ably from "ably";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import {
  NOTIFICATION_MESSAGE_NAME,
  notificationChannel,
  type NotificationMessage,
} from "./channels";

/**
 * The publish half of realtime, and the token half.
 *
 * Nothing here is on the correctness path: a notification row is written first and this is
 * called afterwards, so Ably being unset, slow, or down costs the reader a live badge and
 * nothing else. The bell's poll is the guarantee; this is the shortcut.
 */

/** Ably's batch publish takes at most 100 channels per request. */
const BATCH_CHANNEL_LIMIT = 100;

/** One hour is short enough that a revoked account cannot keep listening for long. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

let rest: Ably.Rest | null = null;

export function ablyConfigured(): boolean {
  return Boolean(env.ABLY_API_KEY);
}

function restClient(): Ably.Rest | null {
  if (!env.ABLY_API_KEY) return null;
  rest ??= new Ably.Rest({ key: env.ABLY_API_KEY });
  return rest;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

/**
 * Publishes one message per recipient, batched. Failures are logged and swallowed: the rows
 * already exist, so the worst case is a badge that appears on the next poll.
 */
export async function publishNotifications(
  messages: readonly NotificationMessage[],
): Promise<void> {
  const client = restClient();
  if (!client || messages.length === 0) return;

  for (const batch of chunk(messages, BATCH_CHANNEL_LIMIT)) {
    try {
      const results = await client.batchPublish(
        batch.map((message) => ({
          channels: [notificationChannel(message.userId)],
          messages: [{ name: NOTIFICATION_MESSAGE_NAME, data: message }],
        })),
      );
      const failed = results.filter((result) => result.failureCount > 0).length;
      if (failed > 0) {
        log("warn", "Ably batch publish reported failures", { failed, attempted: batch.length });
      }
    } catch (error: unknown) {
      log("warn", "Ably publish failed", {
        error: error instanceof Error ? error.message : String(error),
        attempted: batch.length,
      });
    }
  }
}

/**
 * A TokenRequest for exactly one subscription.
 *
 * The channel is derived from the session, never from the request: the browser receives no
 * publish capability and no ability to name another account's channel. Ably allows a token
 * to narrow the issuing key's capabilities but never widen them, so the key itself should be
 * scoped to subscribe on `notifications:*` as well.
 */
export async function createNotificationTokenRequest(userId: string): Promise<Ably.TokenRequest> {
  const client = restClient();
  if (!client) throw new Error("Ably is not configured");

  return client.auth.createTokenRequest({
    clientId: userId,
    ttl: TOKEN_TTL_MS,
    capability: { [notificationChannel(userId)]: ["subscribe"] },
  });
}
