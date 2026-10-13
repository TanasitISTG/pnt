import { createFileRoute } from "@tanstack/react-router";
// inngest/next is the only fetch-style serve handler with streaming in SDK 4.13.0
// (inngest/edge lacks it by design) and is framework-agnostic. TanStack Start is
// off Inngest's supported streaming matrix; verified on Vercel Fluid, so revert to
// inngest/edge without the streaming flag if a deploy regresses.
import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

const handler = serve({ client: inngest, functions, streaming: true });

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      // Second arg is Next's route context — unused by the handler, `{}` satisfies the type.
      GET: async ({ request }) => handler.GET(request as never, {}),
      POST: async ({ request }) => handler.POST(request as never, {}),
      PUT: async ({ request }) => handler.PUT(request as never, {}),
    },
  },
});
