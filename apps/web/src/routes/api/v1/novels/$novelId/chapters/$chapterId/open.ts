import { createFileRoute } from "@tanstack/react-router";
import { chapterIdSchema, novelIdSchema } from "@pnt/contracts/content";
import { successV1Schema } from "@pnt/contracts/reader-api";
import { handleV1, jsonV1, noOtherQueries, parseV1 } from "@/lib/api-v1/handler";
import { openReaderChapterForUser } from "@/lib/reader/reader.service";

export const Route = createFileRoute("/api/v1/novels/$novelId/chapters/$chapterId/open")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleV1(
          request,
          async ({ requireUser }) => {
            noOtherQueries(request, []);
            return jsonV1(
              successV1Schema.parse(
                await openReaderChapterForUser(
                  requireUser(),
                  parseV1(novelIdSchema, params.novelId),
                  parseV1(chapterIdSchema, params.chapterId),
                ),
              ),
            );
          },
          { account: true },
        ),
    },
  },
});
