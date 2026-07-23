import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const baseUrl =
          process.env.APP_URL || import.meta.env.VITE_APP_URL || new URL(request.url).origin;
        const body = `User-agent: *
Allow: /
Allow: /api/sitemap
Disallow: /api/

Sitemap: ${baseUrl}/api/sitemap
`;
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
