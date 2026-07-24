import "@tanstack/react-start/server-only";

import { env } from "@/lib/env";
import { findSource, parseChapter, assertPublicHost, type ScrapedChapter } from "@/lib/scrape";
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

export async function fetchHtml(url: string): Promise<string> {
  const source = findSource(url);
  let html: string;

  if (source.name === "twkan") {
    html = await scraperFetch(url);
  } else {
    try {
      html = await directFetch(url);
    } catch (e: any) {
      if (env.SCRAPER_API_KEY && (e?.cause === 403 || e?.message?.includes("HTTP 403"))) {
        log("info", "Direct fetch got 403, falling back to scraperFetch via ZenRows", { url });
        html = await scraperFetch(url);
      } else if (e?.cause === 403 || e?.message?.includes("HTTP 403")) {
        throw new SafeServerError(
          `Source site ${source.name} returned HTTP 403 Forbidden. Set SCRAPER_API_KEY in .env.local to enable scraper proxy.`,
        );
      } else {
        throw e;
      }
    }
  }

  if (html.length > MAX_HTML_CHARS) {
    log("error", "Scrape page size limit exceeded", { url, length: html.length });
    throw new SafeServerError("Page too large");
  }

  return html;
}

export async function fetchAndParse(url: string): Promise<ScrapedChapter> {
  await assertPublicHost(url); // host whitelist + private IP check before any network I/O
  const html = await fetchHtml(url);
  return parseChapter(html, url);
}
