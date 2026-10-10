import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    SCRAPER_API_KEY: "secret+/=key",
    SCRAPER_BASE: "https://api.zenrows.com/v1/",
    SCRAPINGBEE_API_KEY: "scrapingbee-secret",
    FIRECRAWL_API_KEY: "firecrawl-secret",
  },
}));
vi.mock("@/lib/log", () => ({ log: mocks.log }));
vi.mock("@/lib/scrape/network-policy.server", () => ({
  assertPublicHost: vi.fn(),
  fetchFromPublicHost: vi.fn(),
}));

import { firecrawlFetch, scraperFetch } from "./server";

const sourceUrl = "https://twkan.com/txt/93984/52204812";

beforeEach(() => {
  mocks.log.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function loggedText(): string {
  return JSON.stringify(mocks.log.mock.calls);
}

describe("scrape proxy error boundaries", () => {
  it("never logs a ZenRows API key when the authenticated endpoint redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 302, headers: { location: "/next" } })),
    );

    await expect(scraperFetch(sourceUrl)).rejects.toThrow(
      "ZenRows attempted a redirect (HTTP 302) - blocked",
    );

    expect(loggedText()).not.toContain("secret+/=key");
    expect(loggedText()).not.toContain("secret%2B%2F%3Dkey");
    expect(loggedText()).toContain("HIDDEN_KEY");
  });

  it("forwards source query parameters without logging their values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>ok</html>"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(scraperFetch(`${sourceUrl}?token=sentinel-secret`)).resolves.toBe(
      "<html>ok</html>",
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("sentinel-secret");
    expect(loggedText()).not.toContain("sentinel-secret");
  });

  it("does not expose or log an upstream proxy error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "sentinel-secret upstream URL/key" }, { status: 401 }),
        ),
    );

    const error = await scraperFetch(sourceUrl).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: "ZenRows returned HTTP 401", cause: 401 });
    expect(String(error)).not.toContain("sentinel-secret");
    expect(loggedText()).not.toContain("sentinel-secret");
  });

  it("retries a challenge status even when cancelling its body fails", async () => {
    const failedBody = new ReadableStream({
      cancel: () => Promise.reject(new Error("secret cancellation detail")),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(failedBody, { status: 500 }))
      .mockResolvedValueOnce(new Response("<html>retried</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(scraperFetch("https://www.biquge.tw/book/8143360/82204461.html")).resolves.toBe(
      "<html>retried</html>",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loggedText()).not.toContain("secret cancellation detail");
  });

  it("maps Firecrawl validation errors to a fixed public message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ success: false, error: "sentinel-secret upstream detail" }),
        ),
    );

    await expect(firecrawlFetch(sourceUrl)).rejects.toThrow(
      "Firecrawl returned an invalid response",
    );
    expect(loggedText()).not.toContain("sentinel-secret");
  });

  it("sanitizes malformed successful Firecrawl JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("sentinel-secret malformed JSON", { status: 200 })),
    );

    const error = await firecrawlFetch(sourceUrl).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: "Firecrawl returned an invalid response" });
    expect(String(error)).not.toContain("sentinel-secret");
    expect(loggedText()).not.toContain("sentinel-secret");
  });
});
