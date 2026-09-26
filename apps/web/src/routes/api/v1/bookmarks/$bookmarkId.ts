import { createFileRoute } from "@tanstack/react-router";
import { bookmarkIdSchema } from "@pnt/contracts/content";
import { bookmarkNoteV1Schema, successV1Schema } from "@pnt/contracts/reader-api";
import { bodyV1, handleV1, jsonV1, noOtherQueries, parseV1 } from "@/lib/api-v1/handler";
import {
  editReaderBookmarkNoteForUser,
  removeReaderBookmarkForUser,
} from "@/lib/reader/reader.service";

export const Route = createFileRoute("/api/v1/bookmarks/$bookmarkId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handleV1(
          request,
          async ({ requireUser }) => {
            noOtherQueries(request, []);
            const { note } = await bodyV1(request, bookmarkNoteV1Schema);
            return jsonV1(
              successV1Schema.parse(
                await editReaderBookmarkNoteForUser(
                  requireUser(),
                  parseV1(bookmarkIdSchema, params.bookmarkId),
                  note,
                ),
              ),
            );
          },
          { account: true },
        ),
      DELETE: ({ request, params }) =>
        handleV1(
          request,
          async ({ requireUser }) => {
            noOtherQueries(request, []);
            return jsonV1(
              successV1Schema.parse(
                await removeReaderBookmarkForUser(
                  requireUser(),
                  parseV1(bookmarkIdSchema, params.bookmarkId),
                ),
              ),
            );
          },
          { account: true },
        ),
    },
  },
});
