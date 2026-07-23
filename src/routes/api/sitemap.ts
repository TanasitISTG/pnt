import { createFileRoute } from "@tanstack/react-router";
import { eq, and, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";

const escapeXml = (str: string) =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const Route = createFileRoute("/api/sitemap")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const now = new Date();
          const baseUrl =
            process.env.APP_URL || import.meta.env.VITE_APP_URL || new URL(request.url).origin;

          const liveNovels = await db
            .select({
              id: novels.id,
              updatedAt: novels.updatedAt,
            })
            .from(novels)
            .where(lte(novels.publishedAt, now));

          const liveChapters = await db
            .select({
              id: chapters.id,
              novelId: chapters.novelId,
              updatedAt: chapters.updatedAt,
            })
            .from(chapters)
            .innerJoin(novels, eq(chapters.novelId, novels.id))
            .where(and(lte(novels.publishedAt, now), lte(chapters.publishedAt, now)));

          const urls: string[] = [
            `  <url>
    <loc>${escapeXml(`${baseUrl}/`)}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`,
          ];

          for (const novel of liveNovels) {
            const lastMod = novel.updatedAt ? new Date(novel.updatedAt).toISOString() : null;
            urls.push(
              `  <url>
    <loc>${escapeXml(`${baseUrl}/novels/${novel.id}`)}</loc>
    ${lastMod ? `<lastmod>${lastMod}</lastmod>` : ""}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`,
            );
          }

          for (const chapter of liveChapters) {
            const lastMod = chapter.updatedAt ? new Date(chapter.updatedAt).toISOString() : null;
            urls.push(
              `  <url>
    <loc>${escapeXml(`${baseUrl}/novels/${chapter.novelId}/chapters/${chapter.id}`)}</loc>
    ${lastMod ? `<lastmod>${lastMod}</lastmod>` : ""}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`,
            );
          }

          const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

          return new Response(xml, {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "public, max-age=3600",
            },
          });
        } catch {
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
