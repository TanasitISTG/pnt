import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { streamBackupForUser } from "@/lib/backup.service";
import { contentDisposition } from "@/lib/filename";

function toReadableStream(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = chunks[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

export const Route = createFileRoute("/api/backups")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return new Response("Unauthorized", { status: 401 });

        const filename = `pnt-backup-${new Date().toISOString().slice(0, 10)}.json`;
        return new Response(toReadableStream(streamBackupForUser(session.user.id)), {
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Disposition": contentDisposition(filename),
            "Content-Type": "application/json; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
