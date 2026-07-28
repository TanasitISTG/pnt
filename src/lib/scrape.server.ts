import "@tanstack/react-start/server-only";

import { z } from "zod";

import { env } from "@/lib/env";
import { findSource, parseChapter, assertPublicHost } from "@/lib/scrape";
import type { ScrapedChapter, ScrapeProvider } from "@/lib/scrape.types";
import { SafeServerError } from "@/lib/server-fn-error";
import { log } from "@/lib/log";

const DIRECT_FETCH_TIMEOUT_MS = 10_000;
const SCRAPER_FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_CHARS = 5_000_000;

export async function directFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });
  if (!res.ok) {
    log("warn", "Direct scrape fetch failed", { url, status: res.status });
    throw new SafeServerError(`Source site returned HTTP ${res.status}`, { cause: res.status });
  }
  return res.text();
}

export async function scraperFetch(url: string, forceJsRender?: boolean): Promise<string> {
  const apiKey = env.SCRAPER_API_KEY;
  if (!apiKey) {
    throw new SafeServerError(
      "Scraping this site requires SCRAPER_API_KEY to be set in environment variables",
    );
  }

  const source = findSource(url);
  const baseUrl = env.SCRAPER_BASE || "https://api.zenrows.com/v1/";

  // twkan requires js_render=true for Cloudflare challenge; biquge is static HTML so js_render=false prevents ad JS redirects
  const defaultJsRender = source.name === "twkan" ? "true" : "false";
  const jsRender = forceJsRender ? "true" : (env.SCRAPER_RENDER_JS ?? defaultJsRender);
  const premiumProxy = env.SCRAPER_PREMIUM_PROXY ?? "false";

  const targetUrl = new URL(baseUrl);
  targetUrl.searchParams.set("apikey", apiKey);
  targetUrl.searchParams.set("url", url);
  if (jsRender === "true") {
    targetUrl.searchParams.set("js_render", "true");
  }
  if (premiumProxy === "true") {
    targetUrl.searchParams.set("premium_proxy", "true");
  }

  log("info", "Executing scraperFetch via ZenRows", {
    url,
    jsRender,
    premiumProxy,
    zenrowsUrl: targetUrl.toString().replace(apiKey, "HIDDEN_KEY"),
  });

  const res = await fetch(targetUrl.toString(), {
    signal: AbortSignal.timeout(SCRAPER_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    let errorDetail = "";
    try {
      const errJson = await res.json();
      errorDetail = errJson.error || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = res.statusText;
    }

    // If ZenRows returned 422 RESP001 or 5xx without JS rendering, retry once with JS rendering enabled
    if ((res.status === 422 || res.status === 500) && !forceJsRender && jsRender !== "true") {
      log("warn", `ZenRows returned HTTP ${res.status}, retrying with forceJsRender=true`, {
        url,
        error: errorDetail,
      });
      return scraperFetch(url, true);
    }

    log("error", "ZenRows scrape fetch failed", { url, status: res.status, error: errorDetail });
    throw new SafeServerError(`Scraper returned HTTP ${res.status}: ${errorDetail}`);
  }

  const text = await res.text();
  const pageTitleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const pageTitle = pageTitleMatch ? pageTitleMatch[1].trim() : "(no title)";

  log("info", "ZenRows scrape fetch completed", {
    url,
    status: res.status,
    length: text.length,
    pageTitle,
    sample: text.slice(0, 300).replace(/\s+/g, " "),
  });

  return text;
}

export async function scrapingBeeFetch(url: string, forceJsRender?: boolean): Promise<string> {
  const apiKey = env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    throw new SafeServerError(
      "Scraping this site requires SCRAPINGBEE_API_KEY to be set in environment variables",
    );
  }

  const source = findSource(url);
  const baseUrl = "https://app.scrapingbee.com/api/v1/";

  const defaultJsRender = source.name === "twkan" ? "true" : "false";
  const jsRender = forceJsRender ? "true" : (env.SCRAPER_RENDER_JS ?? defaultJsRender);
  const premiumProxy = env.SCRAPER_PREMIUM_PROXY ?? "false";

  const targetUrl = new URL(baseUrl);
  targetUrl.searchParams.set("url", url);
  targetUrl.searchParams.set("render_js", jsRender === "true" ? "true" : "false");
  if (premiumProxy === "true") {
    targetUrl.searchParams.set("premium_proxy", "true");
  }

  log("info", "Executing scrapingBeeFetch", {
    url,
    jsRender,
    premiumProxy,
  });

  const res = await fetch(targetUrl.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(SCRAPER_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    let errorDetail = "";
    try {
      const errJson = await res.json();
      errorDetail = errJson.error || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = res.statusText;
    }

    log("error", "ScrapingBee scrape fetch failed", {
      url,
      status: res.status,
      error: errorDetail,
    });
    throw new SafeServerError(`ScrapingBee returned HTTP ${res.status}: ${errorDetail}`);
  }

  return res.text();
}

const firecrawlResponseSchema = z.object({
  success: z.boolean().optional(),
  data: z
    .object({
      rawHtml: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
});

export async function firecrawlFetch(url: string): Promise<string> {
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new SafeServerError(
      "Scraping this site requires FIRECRAWL_API_KEY to be set in environment variables",
    );
  }

  log("info", "Executing firecrawlFetch", { url });

  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["rawHtml"],
      onlyMainContent: false,
    }),
    signal: AbortSignal.timeout(SCRAPER_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    let errorDetail = "";
    try {
      const errJson = await res.json();
      errorDetail = errJson.error || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = res.statusText;
    }

    log("error", "Firecrawl scrape fetch failed", { url, status: res.status, error: errorDetail });
    throw new SafeServerError(`Firecrawl returned HTTP ${res.status}: ${errorDetail}`);
  }

  const json = await res.json();
  const parsed = firecrawlResponseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.data?.rawHtml) {
    const errMessage = parsed.success
      ? parsed.data?.error || "Missing rawHtml in response data"
      : "Invalid Firecrawl response payload";
    log("error", "Firecrawl response validation failed", { url, error: errMessage });
    throw new SafeServerError(`Firecrawl scrape failed: ${errMessage}`);
  }

  return parsed.data.data.rawHtml;
}

export async function fetchHtml(url: string, provider: ScrapeProvider = "auto"): Promise<string> {
  await assertPublicHost(url);

  let html: string;

  if (provider === "auto") {
    const source = findSource(url);
    if (source.name === "twkan") {
      html = await scraperFetch(url);
    } else {
      try {
        html = await directFetch(url);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        const cause = e instanceof Error ? e.cause : undefined;
        if (env.SCRAPER_API_KEY && (cause === 403 || msg.includes("HTTP 403"))) {
          log("info", "Direct fetch got 403, falling back to scraperFetch via ZenRows", { url });
          html = await scraperFetch(url);
        } else if (cause === 403 || msg.includes("HTTP 403")) {
          throw new SafeServerError(
            `Source site ${source.name} returned HTTP 403 Forbidden. Set SCRAPER_API_KEY in .env.local to enable scraper proxy.`,
          );
        } else {
          throw e;
        }
      }
    }
  } else if (provider === "direct") {
    html = await directFetch(url);
  } else if (provider === "zenrows") {
    html = await scraperFetch(url);
  } else if (provider === "scrapingbee") {
    html = await scrapingBeeFetch(url);
  } else if (provider === "firecrawl") {
    html = await firecrawlFetch(url);
  } else {
    throw new SafeServerError(`Unknown scrape provider: ${provider}`);
  }

  if (html.length > MAX_HTML_CHARS) {
    log("error", "Scrape page size limit exceeded", { url, length: html.length });
    throw new SafeServerError("Page too large");
  }

  return html;
}

export async function fetchAndParse(
  url: string,
  provider: ScrapeProvider = "auto",
): Promise<ScrapedChapter> {
  const html = await fetchHtml(url, provider);
  return parseChapter(html, url);
}
