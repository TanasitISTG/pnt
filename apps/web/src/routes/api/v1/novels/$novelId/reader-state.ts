import { createFileRoute } from "@tanstack/react-router";
import { novelIdSchema } from "@pnt/contracts/content";
import { readerStateV1Schema } from "@pnt/contracts/reader-api";
import { handleV1, jsonV1, noOtherQueries, parseV1 } from "@/lib/api-v1/handler";
import { getReaderStateForUser } from "@/lib/reader/reader.service";

export const Route = createFileRoute("/api/v1/novels/$novelId/reader-state")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleV1(
          request,
          async ({ requireUser }) => {
            noOtherQueries(request, []);
            return jsonV1(
              readerStateV1Schema.parse(
                await getReaderStateForUser(requireUser(), parseV1(novelIdSchema, params.novelId)),
              ),
            );
          },
          { account: true },
        ),
    },
  },
});
