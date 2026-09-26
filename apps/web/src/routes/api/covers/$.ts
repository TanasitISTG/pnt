import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { getReadableCover } from "@/lib/content/novel/cover-read.service";
import { checkGuestRateLimit } from "@/lib/rate-limit";
import { NotFoundError, RateLimitError } from "@/lib/server-fn-error";
import { log } from "@/lib/log";

const coverWidthSchema = z.enum(["320", "480", "640"]);

export const Route = createFileRoute("/api/covers/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          if (!session) await checkGuestRateLimit("covers", 120, request.headers);
          const url = new URL(request.url);
          const novelId = url.pathname.split("/").at(-1);
          if (!novelId) return new Response("Not Found", { status: 404 });
          const widths = url.searchParams.getAll("w");
          const parsed = widths.length === 1 ? coverWidthSchema.safeParse(widths[0]) : null;
          if (widths.length > 1 || (widths.length === 1 && !parsed?.success))
            return new Response("Unsupported cover width", { status: 400 });
          const cover = await getReadableCover(
            session?.user.id ?? null,
            novelId,
            parsed?.success ? (Number(parsed.data) as 320 | 480 | 640) : undefined,
          );
          return new Response(Buffer.from(cover.bytes), {
            headers: {
              "Content-Type": cover.mime,
              "Cache-Control": session
                ? "private, max-age=3600"
                : "public, max-age=31536000, immutable",
            },
          });
        } catch (error) {
          if (error instanceof NotFoundError) return new Response("Not Found", { status: 404 });
          if (error instanceof RateLimitError)
            return new Response("Too Many Requests", { status: 429 });
          log("error", "Cover read failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
