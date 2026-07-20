import { createFileRoute } from "@tanstack/react-router";

import { env } from "@/lib/env";
import { runInBackground } from "@/lib/background";
import { runTranslationWorker } from "@/lib/translation/worker";

// Called every minute by an external pinger (cron-job.org) in production,
// and by `bun run worker` locally. Auth: Vercel-style Bearer CRON_SECRET.
// Responds instantly and processes in the background — a chunk can take
// minutes, and a slow response counts as a failed ping at cron-job.org,
// which auto-disables the job after repeated "failures".
async function handler({ request }: { request: Request }) {
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  runInBackground(runTranslationWorker());
  return Response.json({ started: true });
}

export const Route = createFileRoute("/api/cron/translation-worker")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
    },
  },
});
