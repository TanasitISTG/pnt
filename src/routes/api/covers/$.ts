import { createFileRoute } from "@tanstack/react-router";
import { eq, and, lte } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { novels } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/functions";
import { RateLimitError } from "@/lib/server-fn-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { immutablePublicCacheControl } from "@/lib/cache-control";
import { log } from "@/lib/log";
import { getPublicStorage } from "@/lib/storage/index.server";
import { COVER_WIDTHS, coverVariantKey, defaultCoverWidth } from "@/lib/storage/keys";

const coverWidthSchema = z.enum(
  COVER_WIDTHS.map((width) => String(width)) as [string, ...string[]],
);

/**
 * Ownership- and publication-checked cover delivery.
 *
 * Live novels hand the browser a public CDN URL, so this route mainly serves
 * drafts, scheduled novels, and the admin's own previews — the paths where a
 * cover must not be reachable without a session.
 */
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
            ? (Number(widthResult.data) as (typeof COVER_WIDTHS)[number])
            : undefined;
          const [novel] = await db
            .select({
              id: novels.id,
              coverKey: novels.coverKey,
            })
            .from(novels)
            .where(
              session
                ? and(eq(novels.id, novelId), eq(novels.userId, session.user.id))
                : and(eq(novels.id, novelId), lte(novels.publishedAt, new Date())),
            )
            .limit(1);

          if (!novel || !novel.coverKey) {
            return new Response("Not Found", { status: 404 });
          }

          const storage = getPublicStorage();
          const object = await storage.get(
            coverVariantKey(novel.coverKey, requestedWidth ?? defaultCoverWidth()),
          );
          if (!object) {
            return new Response("Not Found", { status: 404 });
          }

          return new Response(object.bytes as unknown as BodyInit, {
            headers: {
              "Content-Type": object.contentType ?? "image/webp",
              // Guest URLs carry ?v=<updatedAt> (bumps on any novel edit), so a
              // changed cover gets a new URL and the old one can be cached forever.
              "Cache-Control": session ? "private, max-age=3600" : immutablePublicCacheControl(),
            },
          });
        } catch (err) {
          if (err instanceof RateLimitError) {
            return new Response("Too Many Requests", { status: 429 });
          }
          log("error", "Cover delivery failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
