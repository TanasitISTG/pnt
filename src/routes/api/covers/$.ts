import { createFileRoute } from "@tanstack/react-router";
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels } from "@/lib/db/schema";
import { ensureSession } from "@/lib/auth.functions";

export const Route = createFileRoute("/api/covers/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await ensureSession();

          // Extract novelId from the last segment of the pathname
          const url = new URL(request.url);
          const parts = url.pathname.split("/");
          const novelId = parts[parts.length - 1];

          const [novel] = await db
            .select({
              id: novels.id,
              cover: novels.cover,
              coverMime: novels.coverMime,
            })
            .from(novels)
            .where(and(eq(novels.id, novelId), eq(novels.userId, session.user.id)))
            .limit(1);

          if (!novel || !novel.cover) {
            return new Response("Not Found", { status: 404 });
          }

          // Drizzle's native bytea column returns Buffer or Uint8Array.
          // Since Uint8Array/Buffer can be sent in Response directly, we convert to Buffer/Uint8Array:
          const buffer = Buffer.isBuffer(novel.cover)
            ? novel.cover
            : Buffer.from(novel.cover as any);

          return new Response(buffer, {
            headers: {
              "Content-Type": novel.coverMime || "image/jpeg",
              "Cache-Control": "private, max-age=3600",
            },
          });
        } catch (err: any) {
          if (err.message === "Unauthorized") {
            return new Response("Unauthorized", { status: 401 });
          }
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
