import { createFileRoute } from "@tanstack/react-router";
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, chapters } from "@/lib/db/schema";
import { chapterVisibleToGuests, novelLive } from "@/lib/content/publish/publish";
import { defaultLocale, localeAlternates, localizedPath } from "@/lib/i18n/locales";
import { RateLimitError } from "@/lib/server-fn-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatingPublicCacheControl } from "@/lib/cache-control";

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
          await checkRateLimit("sitemap", 30);

          const now = new Date();

          const baseUrl =
            process.env.APP_URL || import.meta.env.VITE_APP_URL || new URL(request.url).origin;

          const liveNovels = await db
            .select({
              id: novels.id,
              updatedAt: novels.updatedAt,
            })
            .from(novels)
            .where(novelLive(now));

          const liveChapters = await db
            .select({
              id: chapters.id,
              novelId: chapters.novelId,
              updatedAt: chapters.updatedAt,
            })
            .from(chapters)
            .innerJoin(novels, eq(chapters.novelId, novels.id))
            .where(and(novelLive(now), chapterVisibleToGuests(now)));

          /*
           * Every reading page is two documents, and the sitemap says so: one `xhtml:link`
           * per language plus the `x-default` a reader with no preference lands on. The
           * `loc` stays the canonical - and unprefixed - URL of the default language, which
           * is why `localizedPath` returns the bare path for it.
           */
          const alternatesOf = (pathname: string) => {
            const lines = localeAlternates(pathname).map(
              ({ locale, href }) =>
                `    <xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(`${baseUrl}${href}`)}"/>`,
            );
            lines.push(
              `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(
                `${baseUrl}${localizedPath(pathname, defaultLocale)}`,
              )}"/>`,
            );
            return lines.join("\n");
          };

          const urlEntry = (
            pathname: string,
            options: { lastMod: string | null; changefreq: string; priority: string },
          ) =>
            `  <url>
    <loc>${escapeXml(`${baseUrl}${localizedPath(pathname, defaultLocale)}`)}</loc>
${alternatesOf(pathname)}
    ${options.lastMod ? `<lastmod>${options.lastMod}</lastmod>` : ""}
    <changefreq>${options.changefreq}</changefreq>
    <priority>${options.priority}</priority>
  </url>`;

          const urls: string[] = [
            urlEntry("/", { lastMod: null, changefreq: "daily", priority: "1.0" }),
            urlEntry("/catalog", { lastMod: null, changefreq: "daily", priority: "0.8" }),
          ];

          for (const novel of liveNovels) {
            urls.push(
              urlEntry(`/novels/${novel.id}`, {
                lastMod: novel.updatedAt ? new Date(novel.updatedAt).toISOString() : null,
                changefreq: "weekly",
                priority: "0.8",
              }),
            );
          }

          for (const chapter of liveChapters) {
            urls.push(
              urlEntry(`/novels/${chapter.novelId}/chapters/${chapter.id}`, {
                lastMod: chapter.updatedAt ? new Date(chapter.updatedAt).toISOString() : null,
                changefreq: "monthly",
                priority: "0.6",
              }),
            );
          }

          const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>`;

          return new Response(xml, {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": revalidatingPublicCacheControl(3600, 86400),
            },
          });
        } catch (err) {
          if (err instanceof RateLimitError) {
            return new Response("Too Many Requests", { status: 429 });
          }
          return new Response("Internal Server Error", { status: 500 });
        }
      },
    },
  },
});
