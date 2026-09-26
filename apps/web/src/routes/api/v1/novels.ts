import { createFileRoute } from "@tanstack/react-router";
import { handleV1, jsonV1, noOtherQueries } from "@/lib/api-v1/handler";
import { listNovelsV1 } from "@/lib/api-v1/content";

export const Route = createFileRoute("/api/v1/novels")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleV1(
          request,
          async ({ userId }) => {
            noOtherQueries(request, []);
            return jsonV1(await listNovelsV1(userId));
          },
          { guestBucket: "read" },
        ),
    },
  },
});
