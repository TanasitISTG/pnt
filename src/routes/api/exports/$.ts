import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { createNovelExportResponse } from "@/lib/export/stream";

function parseExportPath(request: Request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const novelId = parts.at(-2);
  const format = parts.at(-1);
  if (!novelId || (format !== "txt" && format !== "epub")) return null;
  return { novelId, format } as const;
}

async function handleExport(request: Request, includeBody: boolean) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const parsed = parseExportPath(request);
  if (!parsed) return new Response("Not Found", { status: 404 });
  return createNovelExportResponse(parsed.novelId, session.user.id, parsed.format, includeBody);
}

export const Route = createFileRoute("/api/exports/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleExport(request, true),
      HEAD: ({ request }) => handleExport(request, false),
    },
  },
});
