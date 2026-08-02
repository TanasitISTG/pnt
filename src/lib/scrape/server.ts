import "@tanstack/react-start/server-only";

import { z } from "zod";

import { env } from "@/lib/env";
import { findSource, parseChapter } from "@/lib/scrape";
import { assertPublicHost } from "@/lib/scrape/network-policy.server";
import type { ScrapedChapter, ScrapeProvider } from "@/lib/scrape/types";
import { SafeServerError } from "@/lib/server-fn-error";
import { log } from "@/lib/log";

const DIRECT_FETCH_TIMEOUT_MS = 10_000;
const SCRAPER_FETCH_TIMEOUT_MS = 30_000;
const MAX_HTML_BYTES = 5_000_000;
const MAX_ERROR_BYTES = 64_000;

async function readResponseText(res: Response, maxBytes = MAX_HTML_BYTES): Promise<string> {
  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      await res.body?.cancel();
      throw new SafeServerError("Page too large");
    }
  }

  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new SafeServerError("Page too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchWithoutRedirects(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  context: string,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    log("warn", `${context} fetch blocked redirect`, { url, status: res.status });
    throw new SafeServerError(`${context} attempted a redirect (HTTP ${res.status}) - blocked`, {
      cause: res.status,
    });
  }
  return res;
}

export async function directFetch(url: string): Promise<string> {
  const res = await fetchWithoutRedirects(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    },
    DIRECT_FETCH_TIMEOUT_MS,
    "Source site",
  );
  if (!res.ok) {
    log("warn", "Direct scrape fetch failed", { url, status: res.status });
    throw new SafeServerError(`Source site returned HTTP ${res.status}`, { cause: res.status });
  }
  return readResponseText(res);
}

// ---------------------------------------------------------------------------
// Proxy providers (ZenRows / ScrapingBee / Firecrawl)
// ---------------------------------------------------------------------------

interface RenderOpts {
  jsRender: string;
  premiumProxy: string;
}

interface ProxyRequest {
  url: string;
  init?: RequestInit;
  /** Redacted URL for logs (API keys stripped). */
  logUrl?: string;
}

interface ProxyProviderSpec {
  /** Display name used in logs and error messages. */
  name: string;
  apiKey: string | undefined;
  /** Env var named in the missing-key error. */
  missingKeyEnv: string;
  buildRequest(url: string, renderOpts: RenderOpts, apiKey: string): ProxyRequest;
  /** Defaults to res.text(). Throw SafeServerError for invalid payloads. */
  parseResponse?: (res: Response) => Promise<string>;
  /** Statuses that trigger one retry with js_render forced on (bot challenges). */
  retryWithJsRenderStatuses?: number[];
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const errJson = JSON.parse(await readResponseText(res, MAX_ERROR_BYTES));
    return errJson.error || errJson.message || JSON.stringify(errJson);
  } catch {
    return res.statusText;
  }
}

async function proxiedFetch(
  spec: ProxyProviderSpec,
  url: string,
  forceJsRender?: boolean,
): Promise<string> {
  if (!spec.apiKey) {
    throw new SafeServerError(
      `Scraping this site requires ${spec.missingKeyEnv} to be set in environment variables`,
    );
  }
  const apiKey = spec.apiKey;

  // twkan requires js_render=true for Cloudflare challenge; biquge is static
  // HTML so js_render=false prevents ad JS redirects.
  const source = findSource(url);
  const defaultJsRender = source.name === "twkan" ? "true" : "false";
  const jsRender = forceJsRender ? "true" : (env.SCRAPER_RENDER_JS ?? defaultJsRender);
  const premiumProxy = env.SCRAPER_PREMIUM_PROXY ?? "false";

  const req = spec.buildRequest(url, { jsRender, premiumProxy }, apiKey);

  log("info", `Executing ${spec.name} fetch`, {
    url,
    jsRender,
    premiumProxy,
    ...(req.logUrl ? { requestUrl: req.logUrl } : {}),
  });

  const res = await fetchWithoutRedirects(
    req.url,
    req.init ?? {},
    SCRAPER_FETCH_TIMEOUT_MS,
    spec.name,
  );

  if (!res.ok) {
    const errorDetail = await parseErrorDetail(res);

    if (
      spec.retryWithJsRenderStatuses?.includes(res.status) &&
      !forceJsRender &&
      jsRender !== "true"
    ) {
      log("warn", `${spec.name} returned HTTP ${res.status}, retrying with forceJsRender=true`, {
        url,
        error: errorDetail,
      });
      return proxiedFetch(spec, url, true);
    }

    log("error", `${spec.name} scrape fetch failed`, {
      url,
      status: res.status,
      error: errorDetail,
    });
    throw new SafeServerError(`${spec.name} returned HTTP ${res.status}: ${errorDetail}`, {
      cause: res.status,
    });
  }

  return spec.parseResponse ? spec.parseResponse(res) : readResponseText(res);
}

const zenrowsSpec: ProxyProviderSpec = {
  name: "ZenRows",
  apiKey: env.SCRAPER_API_KEY,
  missingKeyEnv: "SCRAPER_API_KEY",
  retryWithJsRenderStatuses: [422, 500],
  buildRequest(url, { jsRender, premiumProxy }, apiKey) {
    const baseUrl = env.SCRAPER_BASE || "https://api.zenrows.com/v1/";
    const targetUrl = new URL(baseUrl);
    targetUrl.searchParams.set("apikey", apiKey);
    targetUrl.searchParams.set("url", url);
    if (jsRender === "true") {
      targetUrl.searchParams.set("js_render", "true");
    }
    if (premiumProxy === "true") {
      targetUrl.searchParams.set("premium_proxy", "true");
    }
    return {
      url: targetUrl.toString(),
      logUrl: targetUrl.toString().replace(apiKey, "HIDDEN_KEY"),
    };
  },
};

export async function scraperFetch(url: string, forceJsRender?: boolean): Promise<string> {
  const text = await proxiedFetch(zenrowsSpec, url, forceJsRender);

  const pageTitleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  log("info", "ZenRows scrape fetch completed", {
    url,
    length: text.length,
    pageTitle: pageTitleMatch ? pageTitleMatch[1].trim() : "(no title)",
    sample: text.slice(0, 300).replace(/\s+/g, " "),
  });

  return text;
}

const scrapingBeeSpec: ProxyProviderSpec = {
  name: "ScrapingBee",
  apiKey: env.SCRAPINGBEE_API_KEY,
  missingKeyEnv: "SCRAPINGBEE_API_KEY",
  buildRequest(url, { jsRender, premiumProxy }, apiKey) {
    const targetUrl = new URL("https://app.scrapingbee.com/api/v1/");
    targetUrl.searchParams.set("url", url);
    targetUrl.searchParams.set("render_js", jsRender === "true" ? "true" : "false");
    if (premiumProxy === "true") {
      targetUrl.searchParams.set("premium_proxy", "true");
    }
    return {
      url: targetUrl.toString(),
      init: { headers: { Authorization: `Bearer ${apiKey}` } },
    };
  },
};

export async function scrapingBeeFetch(url: string, forceJsRender?: boolean): Promise<string> {
  return proxiedFetch(scrapingBeeSpec, url, forceJsRender);
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

const firecrawlSpec: ProxyProviderSpec = {
  name: "Firecrawl",
  apiKey: env.FIRECRAWL_API_KEY,
  missingKeyEnv: "FIRECRAWL_API_KEY",
  buildRequest(url, _renderOpts, apiKey) {
    return {
      url: "https://api.firecrawl.dev/v2/scrape",
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, formats: ["rawHtml"], onlyMainContent: false }),
      },
    };
  },
  async parseResponse(res) {
    const json = JSON.parse(await readResponseText(res));
    const parsed = firecrawlResponseSchema.safeParse(json);
    if (!parsed.success || !parsed.data.data?.rawHtml) {
      const errMessage = parsed.success
        ? parsed.data?.error || "Missing rawHtml in response data"
        : "Invalid Firecrawl response payload";
      log("error", "Firecrawl response validation failed", { error: errMessage });
      throw new SafeServerError(`Firecrawl scrape failed: ${errMessage}`);
    }
    return parsed.data.data.rawHtml;
  },
};

export async function firecrawlFetch(url: string): Promise<string> {
  return proxiedFetch(firecrawlSpec, url);
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

  return html;
}

export async function fetchAndParse(
  url: string,
  provider: ScrapeProvider = "auto",
): Promise<ScrapedChapter> {
  const html = await fetchHtml(url, provider);
  return parseChapter(html, url);
}
