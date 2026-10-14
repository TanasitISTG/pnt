import { createFileRoute } from "@tanstack/react-router";

import { auth, type User } from "@/lib/auth/auth";
import { hasAdminRole } from "@/lib/auth/roles";
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
        // Operator-only, and enforced here rather than only in the settings UI: the stream
        // walks every novel, chapter, cover and glossary term the account owns, which is
        // exactly the metered transfer a shared production database cannot absorb.
        const sessionUser: User = session.user;
        if (!hasAdminRole(sessionUser.role)) return new Response("Forbidden", { status: 403 });

        const filename = `pnt-backup-${new Date().toISOString().slice(0, 10)}.json`;
        return new Response(toReadableStream(streamBackupForUser(sessionUser.id)), {
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
