import { createFileRoute } from "@tanstack/react-router";

import { env } from "@/lib/env";
import { runTranslationWorker } from "@/lib/translation/worker";

// Called every minute by an external pinger (cron-job.org) in production,
// and by `bun run worker` locally. Auth: Vercel-style Bearer CRON_SECRET.
async function handler({ request }: { request: Request }) {
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await runTranslationWorker();
    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: err?.message || "Worker error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/cron/translation-worker")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
