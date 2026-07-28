import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { directFetch, fetchHtml } from "@/lib/scrape.server";
import { SafeServerError } from "@/lib/server-fn-error";

describe("scrape.server", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("directFetch passes redirect: manual (redirects blocked via 3xx check)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("<html><body>Content</body></html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await directFetch("https://www.quanben.io/n/test/1.html");
    expect(result).toBe("<html><body>Content</body></html>");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.quanben.io/n/test/1.html",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("directFetch rejects 3xx responses as blocked redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await directFetch("https://www.quanben.io/n/test/1.html").catch((e) => e);
    expect(err).toBeInstanceOf(SafeServerError);
    expect(err.message).toContain("redirect");
    expect(err.message).toContain("302");
  });

  it("directFetch does not misclassify network failures as redirects", async () => {
    // undici throws TypeError("fetch failed") for DNS/connection errors —
    // those must surface as-is, not as a "redirect blocked" message.
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const err = await directFetch("https://www.quanben.io/n/test/1.html").catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(SafeServerError);
  });

  it("fetchHtml rejects body > MAX_HTML_CHARS", async () => {
    const hugeHtml = "a".repeat(5_000_001);
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(hugeHtml, { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchHtml("https://www.quanben.io/n/test/1.html", "direct")).rejects.toThrow(
      SafeServerError,
    );
    await expect(fetchHtml("https://www.quanben.io/n/test/1.html", "direct")).rejects.toThrow(
      "Page too large",
    );
  });
});
