import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { novelIdSchema } from "@pnt/contracts/content";
import { getReadableCover } from "@/lib/content/novel/cover-read.service";
import { handleV1, noOtherQueries, parseV1, queryPair } from "@/lib/api-v1/handler";

const widthSchema = z.enum(["320", "480", "640"]);

export const Route = createFileRoute("/api/v1/novels/$novelId/cover")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleV1(
          request,
          async ({ userId }) => {
            noOtherQueries(request, ["w"]);
            const width = queryPair(request, "w");
            // Unlike the legacy cover URL, v1 has a required variant width.
            const parsedWidth = parseV1(widthSchema, width);
            const cover = await getReadableCover(
              userId,
              parseV1(novelIdSchema, params.novelId),
              Number(parsedWidth) as 320 | 480 | 640,
            );
            return new Response(Buffer.from(cover.bytes), {
              headers: { "Content-Type": cover.mime, "Cache-Control": "no-store" },
            });
          },
          { guestBucket: "covers" },
        ),
    },
  },
});
