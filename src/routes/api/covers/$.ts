import { createFileRoute } from "@tanstack/react-router";
import { eq, and, lte } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/functions";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit";
const coverWidthSchema = z.enum(["320", "480", "640"]);

export const Route = createFileRoute("/api/covers/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getSession();

          // Guests are rate-limited; the admin browsing their own library is not.
          if (!session) await checkRateLimit("covers", 120);

          // Extract novelId from the last segment of the pathname
          const url = new URL(request.url);
          const parts = url.pathname.split("/");
          const novelId = parts[parts.length - 1];
          const widthParams = url.searchParams.getAll("w");
          const widthResult =
            widthParams.length === 1 ? coverWidthSchema.safeParse(widthParams[0]) : null;
          if (widthParams.length > 1 || (widthParams.length === 1 && !widthResult?.success)) {
            return new Response("Unsupported cover width", { status: 400 });
          }
          const requestedWidth = widthResult?.success
            ? (Number(widthResult.data) as 320 | 480 | 640)
            : undefined;
          const [novel] = await db
            .select({
              id: novels.id,
              cover: novels.cover,
              coverMime: novels.coverMime,
            })
            .from(novels)
            .where(
              session
                ? and(eq(novels.id, novelId), eq(novels.userId, session.user.id))
                : and(eq(novels.id, novelId), lte(novels.publishedAt, new Date())),
            )
            .limit(1);

          if (!novel || !novel.cover) {
            return new Response("Not Found", { status: 404 });
          }

          // Drizzle's native bytea column returns Buffer or Uint8Array.
          // Since Uint8Array/Buffer can be sent in Response directly, we convert to Buffer/Uint8Array:
          const buffer = Buffer.isBuffer(novel.cover)
            ? novel.cover
            : Buffer.from(novel.cover as Uint8Array);

          const cacheControl = session
            ? "private, max-age=3600"
            : "public, max-age=31536000, immutable";
          if (requestedWidth) {
            // Sharp stays out of the browser graph and only loads for variant requests.
            const { resizeCover } = await import("@/lib/content/cover-image.server");
            const resized = await resizeCover(new Uint8Array(buffer), requestedWidth);
            return new Response(Buffer.from(resized), {
              headers: {
                "Content-Type": "image/webp",
                "Cache-Control": cacheControl,
              },
            });
          }

          return new Response(new Uint8Array(buffer), {
            headers: {
              "Content-Type": novel.coverMime || "image/jpeg",
              // Guest URLs carry ?v=<updatedAt> (bumps on any novel edit), so a
              // changed cover gets a new URL and the old one can be cached forever.
              "Cache-Control": cacheControl,
            },
          });
        } catch (err) {
          if (err instanceof RateLimitError) {
            return new Response("Too Many Requests", { status: 429 });
          }
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
