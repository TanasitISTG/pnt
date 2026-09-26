import { describe, expect, it, mock } from "bun:test";
import { createPntApiClient, PntApiError } from "./client";
import { v1Keys } from "./queries";

const novel = {
  id: "n",
  title: "Story",
  originalTitle: null,
  author: null,
  description: null,
  sourceLang: "en",
  targetLang: "th",
  publishedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  hasCover: false,
  chapterCount: 1,
  translatedCount: 0,
};

describe("native v1 client", () => {
  it("requires an absolute origin without a trailing slash", () => {
    expect(() => createPntApiClient({ baseUrl: "relative" })).toThrow();
    expect(() => createPntApiClient({ baseUrl: "https://example.test/" })).toThrow();
    expect(() => createPntApiClient({ baseUrl: "https://example.test/path" })).toThrow();
  });

  it("encodes IDs, forwards only nonempty awaited cookies, and omits browser credentials", async () => {
    const fetchImpl = mock(async (url: string | URL | Request, _init?: RequestInit) =>
      Response.json(
        String(url).endsWith("/api/v1/novels")
          ? [novel]
          : { ...novel, chapterCount: undefined, translatedCount: undefined },
      ),
    );
    const getCookie = mock(async () => "session=private");
    const client = createPntApiClient({ baseUrl: "https://example.test", getCookie, fetchImpl });
    expect((await client.listNovels())[0]?.hasCover).toBe(false);
    await client.getNovel("a/b"); // The next fixture is a detail, not a list.
    expect(getCookie).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe("https://example.test/api/v1/novels/a%2Fb");
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("Cookie")).toBe("session=private");
  });

  it("does not attach a guest Cookie header", async () => {
    const fetchImpl = mock(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json([novel]),
    );
    const client = createPntApiClient({ baseUrl: "https://example.test", fetchImpl });
    await client.listNovels();
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has("Cookie")).toBe(false);
  });

  it("uses JSON content type even for bodyless account writes", async () => {
    const fetchImpl = mock(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ success: true }),
    );
    const client = createPntApiClient({ baseUrl: "https://example.test", fetchImpl });
    await client.openChapter("n", "c");
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBeUndefined();
  });

  it("maps all v1 error envelopes with status and code", async () => {
    const codes = [
      [400, "INVALID_REQUEST"],
      [401, "UNAUTHORIZED"],
      [404, "NOT_FOUND"],
      [429, "RATE_LIMITED"],
      [500, "INTERNAL_ERROR"],
    ] as const;
    for (const [status, code] of codes) {
      const client = createPntApiClient({
        baseUrl: "https://example.test",
        fetchImpl: async () => Response.json({ error: { code, message: "Safe" } }, { status }),
      });
      try {
        await client.listNovels();
        throw new Error("Expected API error");
      } catch (error) {
        expect(error).toBeInstanceOf(PntApiError);
        expect((error as PntApiError).status).toBe(status);
        expect((error as PntApiError).code).toBe(code);
      }
    }
  });

  it("validates ISO dates and numeric-string chapter numbers", async () => {
    const client = createPntApiClient({
      baseUrl: "https://example.test",
      fetchImpl: async () =>
        Response.json([{ id: "c", number: "1.25", title: "A", translatedTitle: null }]),
    });
    expect((await client.getManifest("n"))[0]?.number).toBe("1.25");
    const invalid = createPntApiClient({
      baseUrl: "https://example.test",
      fetchImpl: async () => Response.json([{ ...novel, createdAt: 1 }]),
    });
    await expect(invalid.listNovels()).rejects.toMatchObject({
      status: 200,
      code: "INTERNAL_ERROR",
      name: "PntApiError",
    });
  });

  it("wraps malformed successful JSON as a typed API error", async () => {
    const client = createPntApiClient({
      baseUrl: "https://example.test",
      fetchImpl: async () => new Response("<html>not JSON</html>", { status: 200 }),
    });
    await expect(client.listNovels()).rejects.toMatchObject({
      status: 200,
      code: "INTERNAL_ERROR",
      name: "PntApiError",
    });
  });

  it("partitions account keys and preserves timestamp cursor text", async () => {
    expect(v1Keys.readerState("user1", "n")).not.toEqual(v1Keys.readerState("user2", "n"));
    expect(() => v1Keys.readerState("guest", "n")).toThrow();
    const fetchImpl = mock(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ bookmarks: [], nextCursor: null }),
    );
    const client = createPntApiClient({ baseUrl: "https://example.test", fetchImpl });
    await client.listBookmarks("n", { createdAt: "2026-01-01 12:13:14.123456", id: "a/b" });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("cursorCreatedAt")).toBe("2026-01-01 12:13:14.123456");
    expect(url.searchParams.get("cursorId")).toBe("a/b");
  });
});
