import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getSession } from "@/lib/auth/functions";
import { immutablePublicCacheControl } from "@/lib/cache-control";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { checkRateLimit } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/server-fn-error";
import { getPublicStorage } from "@/lib/storage/index.server";
import {
  AVATAR_WIDTHS,
  avatarPrefix,
  avatarVariantKey,
  defaultAvatarWidth,
} from "@/lib/storage/keys";

const avatarWidthSchema = z.enum(
  AVATAR_WIDTHS.map((width) => String(width)) as [string, ...string[]],
);

/**
 * Avatar delivery for the adapter that has no public origin (local dev, CI).
 *
 * Production serves these variants straight from the CDN, so this route is the
 * fallback rather than the norm. The path repeats the stored unguessable segment,
 * which is what makes an immutable response correct: a replaced photo is a new URL
 * and never shares a cache entry with the old bytes.
 */
export const Route = createFileRoute("/api/avatars/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await getSession();

          // Guests are rate-limited; the signed-in admin viewing their own photo is not.
          if (!session) await checkRateLimit("avatars", 120);

          const url = new URL(request.url);
          const parts = url.pathname.split("/");
          const segment = parts[parts.length - 1];
          const userId = parts[parts.length - 2];
          if (!userId || !segment) {
            return new Response("Not Found", { status: 404 });
          }

          const widthParams = url.searchParams.getAll("w");
          const widthResult =
            widthParams.length === 1 ? avatarWidthSchema.safeParse(widthParams[0]) : null;
          if (widthParams.length > 1 || (widthParams.length === 1 && !widthResult?.success)) {
            return new Response("Unsupported avatar width", { status: 400 });
          }
          const requestedWidth = widthResult?.success
            ? (Number(widthResult.data) as (typeof AVATAR_WIDTHS)[number])
            : undefined;

          const [row] = await db
            .select({ image: userTable.image })
            .from(userTable)
            .where(eq(userTable.id, userId))
            .limit(1);

          const expectedKey = avatarPrefix(userId, segment);
          if (!row?.image || row.image !== expectedKey) {
            return new Response("Not Found", { status: 404 });
          }

          const object = await getPublicStorage().get(
            avatarVariantKey(expectedKey, requestedWidth ?? defaultAvatarWidth()),
          );
          if (!object) {
            return new Response("Not Found", { status: 404 });
          }

          return new Response(object.bytes as unknown as BodyInit, {
            headers: {
              "Content-Type": object.contentType ?? "image/webp",
              "Cache-Control": immutablePublicCacheControl(),
            },
          });
        } catch (err) {
          if (err instanceof RateLimitError) {
            return new Response("Too Many Requests", { status: 429 });
          }
          log("error", "Avatar delivery failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
