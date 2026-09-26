import { createFileRoute } from "@tanstack/react-router";
import { chapterIdSchema, novelIdSchema } from "@pnt/contracts/content";
import { positionV1Schema, successV1Schema } from "@pnt/contracts/reader-api";
import { bodyV1, handleV1, jsonV1, noOtherQueries, parseV1 } from "@/lib/api-v1/handler";
import { writeReaderPositionForUser } from "@/lib/reader/reader.service";

export const Route = createFileRoute("/api/v1/novels/$novelId/chapters/$chapterId/position")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        handleV1(
          request,
          async ({ requireUser }) => {
            noOtherQueries(request, []);
            const { scrollFraction } = await bodyV1(request, positionV1Schema);
            return jsonV1(
              successV1Schema.parse(
                await writeReaderPositionForUser(
                  requireUser(),
                  parseV1(novelIdSchema, params.novelId),
                  parseV1(chapterIdSchema, params.chapterId),
                  scrollFraction,
                ),
              ),
            );
          },
          { account: true },
        ),
    },
  },
});
