import { createFileRoute } from "@tanstack/react-router";
import { novelIdSchema } from "@pnt/contracts/content";
import { getManifestV1 } from "@/lib/api-v1/content";
import { handleV1, jsonV1, noOtherQueries, parseV1 } from "@/lib/api-v1/handler";

export const Route = createFileRoute("/api/v1/novels/$novelId/manifest")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleV1(
          request,
          async ({ userId }) => {
            noOtherQueries(request, []);
            return jsonV1(await getManifestV1(userId, parseV1(novelIdSchema, params.novelId)));
          },
          { guestBucket: "read" },
        ),
    },
  },
});
