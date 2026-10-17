import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import {
  ablyConfigured,
  createNotificationTokenRequest,
} from "@/lib/notifications/realtime.server";

/**
 * The browser's way into Ably, and the only one.
 *
 * The response is a TokenRequest, not a key: it names the session's own channel, grants
 * `subscribe` and nothing else, and expires in an hour. The channel is derived here from the
 * verified session rather than from anything the request says, which is what makes the
 * per-account boundary a server decision. An empty `ABLY_API_KEY` answers 503 and the bell
 * falls back to its poll instead of retrying a route that cannot work.
 */
export const Route = createFileRoute("/api/realtime/token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return new Response("Unauthorized", { status: 401 });
        // No body: the client treats a non-OK answer as "no socket" and never shows this,
        // so the response carries no untranslated sentence into the product.
        if (!ablyConfigured()) return new Response(null, { status: 503 });

        const tokenRequest = await createNotificationTokenRequest(session.user.id);
        return new Response(JSON.stringify(tokenRequest), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
          },
        });
      },
    },
  },
});
