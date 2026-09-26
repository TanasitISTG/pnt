import { createFileRoute } from "@tanstack/react-router";
import { novelIdSchema } from "@pnt/contracts/content";
import {
  bookmarkCreatedV1Schema,
  bookmarkCursorV1Schema,
  bookmarkPageV1Schema,
  createBookmarkV1Schema,
} from "@pnt/contracts/reader-api";
import {
  bodyV1,
  handleV1,
  InvalidRequestError,
  jsonV1,
  noOtherQueries,
  parseV1,
  queryPair,
} from "@/lib/api-v1/handler";
import {
  addReaderBookmarkForUser,
  listReaderBookmarkPageForUser,
} from "@/lib/reader/reader.service";

export const Route = createFileRoute("/api/v1/novels/$novelId/bookmarks")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleV1(
          request,
          async ({ requireUser }) => {
            noOtherQueries(request, ["cursorCreatedAt", "cursorId"]);
            const createdAt = queryPair(request, "cursorCreatedAt");
            const id = queryPair(request, "cursorId");
            if ((createdAt === null) !== (id === null)) throw new InvalidRequestError();
            const cursor =
              createdAt !== null && id !== null
                ? parseV1(bookmarkCursorV1Schema, { createdAt, id })
                : null;
            return jsonV1(
              bookmarkPageV1Schema.parse(
                await listReaderBookmarkPageForUser(
                  requireUser(),
                  parseV1(novelIdSchema, params.novelId),
                  cursor,
                ),
              ),
            );
          },
          { account: true },
        ),
      POST: ({ request, params }) =>
        handleV1(
          request,
          async ({ requireUser }) => {
            noOtherQueries(request, []);
            const input = await bodyV1(request, createBookmarkV1Schema);
            const result = await addReaderBookmarkForUser(
              requireUser(),
              parseV1(novelIdSchema, params.novelId),
              input,
            );
            return jsonV1(bookmarkCreatedV1Schema.parse(result), result.duplicate ? 200 : 201);
          },
          { account: true },
        ),
    },
  },
});
