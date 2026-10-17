"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Realtime, RealtimeChannel, TokenRequest } from "ably";

import {
  NOTIFICATION_MESSAGE_NAME,
  notificationChannel,
  type NotificationMessage,
} from "@/lib/notifications/channels";
import { notificationKeys } from "@/lib/notifications/query";

/**
 * The socket half of the bell.
 *
 * It is created after mount and torn down on unmount, because there is no connection to make
 * while rendering on the server and a StrictMode double-mount must not leak one. The token
 * route is probed first: a deployment without `ABLY_API_KEY` answers 503, and this then does
 * nothing at all rather than reconnecting against a route that cannot succeed. The poll in
 * `notificationsQueryOptions` is what still keeps the bell current.
 *
 * A message is a hint, never a record: it invalidates the query, and `onArrival` decorates
 * the moment (a toast). If the socket is down, the next poll produces the same bell.
 */
export function useNotificationStream(
  userId: string | null,
  onArrival?: (message: NotificationMessage) => void,
): void {
  const queryClient = useQueryClient();
  // Held in a ref so a caller passing an inline arrow does not reconnect the socket on
  // every render.
  const arrival = useRef(onArrival);

  useEffect(() => {
    arrival.current = onArrival;
  }, [onArrival]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let client: Realtime | null = null;
    let channel: RealtimeChannel | null = null;

    const fetchTokenRequest = async (): Promise<TokenRequest> => {
      const response = await fetch("/api/realtime/token", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`realtime token refused: ${response.status}`);
      return (await response.json()) as TokenRequest;
    };

    const start = async () => {
      // One request decides both questions: is realtime configured, and what is the first
      // credential? The SDK is handed that same request, so a session costs one token call.
      let first: TokenRequest | null;
      try {
        first = await fetchTokenRequest();
      } catch {
        return;
      }
      if (cancelled) return;

      const { Realtime } = await import("ably");
      if (cancelled) return;

      client = new Realtime({
        authCallback: (_params, callback) => {
          if (first) {
            const pending = first;
            first = null;
            callback(null, pending);
            return;
          }
          void fetchTokenRequest().then(
            (tokenRequest) => callback(null, tokenRequest),
            // The SDK's failure slot takes an `ErrorInfo` or a message string, not an Error.
            (error: unknown) =>
              callback(error instanceof Error ? error.message : String(error), null),
          );
        },
      });

      // Subscribe-only, matching the token: asking for publish here would fail the attach.
      channel = client.channels.get(notificationChannel(userId), { modes: ["subscribe"] });
      await channel.subscribe(NOTIFICATION_MESSAGE_NAME, (message) => {
        void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
        const data = message.data as NotificationMessage | undefined;
        if (data) arrival.current?.(data);
      });
    };

    void start().catch(() => {
      // A refused or dropped connection costs a live badge, never a notification.
      client?.close();
    });

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe(NOTIFICATION_MESSAGE_NAME);
      client?.close();
    };
  }, [userId, queryClient]);
}
