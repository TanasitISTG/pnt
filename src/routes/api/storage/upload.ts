import { createFileRoute } from "@tanstack/react-router";

import { getStorage, isLocalStorage } from "@/lib/storage/index.server";
import { verifyLocalUploadToken } from "@/lib/storage/local.server";

/**
 * Receives the PUTs that the filesystem adapter presigns for local development and
 * CI. Production always configures R2, so this route answers 404 there and is
 * never reachable through the public CDN origin.
 */
export const Route = createFileRoute("/api/storage/upload")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        if (!isLocalStorage()) return new Response("Not Found", { status: 404 });

        const params = new URL(request.url).searchParams;
        const bucket = params.get("bucket");
        const key = params.get("key");
        const expires = Number(params.get("expires"));
        const signature = params.get("signature") ?? "";

        if ((bucket !== "public" && bucket !== "private") || !key) {
          return new Response("Bad Request", { status: 400 });
        }
        if (!verifyLocalUploadToken({ bucket, key, expires, signature })) {
          return new Response("Forbidden", { status: 403 });
        }

        const bytes = new Uint8Array(await request.arrayBuffer());
        await getStorage()[bucket].put(key, bytes, {
          contentType: request.headers.get("content-type") ?? "application/octet-stream",
        });
        return new Response(null, { status: 200 });
      },
    },
  },
});
