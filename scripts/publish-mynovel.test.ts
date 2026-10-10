import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChapterPublishError,
  DEFAULT_MY_NOVEL_SIGNING_KEY,
  createMyNovelSignature,
  postChaptersSequentially,
  parsePublishStatus,
  preflightMyNovelDestination,
  preparePublishItems,
  toMyNovelChapterContent,
  type MyNovelCredentials,
  type PntChapterRow,
  type PublishItem,
} from "./publish-mynovel";

const CREDENTIALS: MyNovelCredentials = {
  token: "test-token",
  signingKey: DEFAULT_MY_NOVEL_SIGNING_KEY,
};

function chapter(overrides: Partial<PntChapterRow> = {}): PntChapterRow {
  return {
    id: "pnt-chapter-1",
    number: "1",
    title: "Source title",
    translatedTitle: "ชื่อตอน",
    translatedContent: "ย่อหน้าแรก\n\nย่อหน้าที่สอง",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function publishItems(): PublishItem[] {
  return preparePublishItems(
    [
      chapter(),
      chapter({
        id: "pnt-chapter-2",
        number: "2",
        translatedTitle: "ตอนสอง",
        translatedContent: "เนื้อหาสอง",
      }),
      chapter({
        id: "pnt-chapter-3",
        number: "3",
        translatedTitle: "ตอนสาม",
        translatedContent: "เนื้อหาสาม",
      }),
    ],
    { bookId: "book-1", chapterPrice: 10, publishStatus: "draft" },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});
describe("MyNovel publish status", () => {
  it.each([
    ["", "draft"],
    ["draft", "draft"],
    [" PUBLISHED ", "published"],
  ])("normalizes %j to %s", (input, expected) => {
    expect(parsePublishStatus(input)).toBe(expected);
  });

  it("rejects unsupported statuses", () => {
    expect(() => parsePublishStatus("scheduled")).toThrow(
      'Publish status must be "draft" or "published"',
    );
  });
});

describe("MyNovel request signing", () => {
  it("matches the captured MyNovel signature vector", () => {
    expect(
      createMyNovelSignature(
        "34545aca-da20-453a-8eb9-3c4c7ff01607",
        "1787839350164",
        "/api/chapters",
        DEFAULT_MY_NOVEL_SIGNING_KEY,
      ),
    ).toBe("26de79d6c14b650422f1a7af6281723f794f3bf60eed39b5ae6c0f2c2479c344");
  });
});

describe("MyNovel chapter preparation", () => {
  it("preserves empty lines while escaping Unicode into inert HTML", () => {
    const content = `ย่อหน้า & <script>"x" 'y'</script>\r\n\r\nอีกตอน`;

    expect(toMyNovelChapterContent(content)).toBe(
      "<p>ย่อหน้า &amp; &lt;script&gt;&quot;x&quot; &#39;y&#39;&lt;/script&gt;</p><p></p><p>อีกตอน</p>",
    );
    expect(toMyNovelChapterContent(content)).not.toContain("<script>");
  });
  it("leaves empty paragraphs for TipTap to render with one trailing break", () => {
    expect(toMyNovelChapterContent("หนึ่ง\n\n\nสอง")).toBe("<p>หนึ่ง</p><p></p><p></p><p>สอง</p>");
  });

  it("orders chapters and emits only the exact draft API body", () => {
    const items = preparePublishItems(
      [
        chapter({
          id: "second",
          number: "2",
          title: "Fallback title",
          translatedTitle: null,
          translatedContent: "Second",
        }),
        chapter({ id: "first", number: "1", translatedTitle: "ตอนแรก" }),
      ],
      { bookId: "destination", chapterPrice: 7, publishStatus: "draft" },
    );

    expect(items.map((item) => item.number)).toEqual(["1", "2"]);
    expect(items[0]?.body).toEqual({
      bookId: "destination",
      chapterTitle: "ตอนแรก",
      chapterContent: "<p>ย่อหน้าแรก</p><p></p><p>ย่อหน้าที่สอง</p>",
      chapterPrice: 7,
      publishStatus: "draft",
      scheduledAt: "",
    });
    expect(items[1]?.body.chapterTitle).toBe("Fallback title");
    expect(Object.keys(items[0]?.body ?? {}).toSorted()).toEqual(
      [
        "bookId",
        "chapterContent",
        "chapterPrice",
        "chapterTitle",
        "publishStatus",
        "scheduledAt",
      ].toSorted(),
    );
  });
  it("emits published bodies when immediate publication is selected", () => {
    const [item] = preparePublishItems([chapter()], {
      bookId: "destination",
      chapterPrice: 10,
      publishStatus: "published",
    });

    expect(item?.body.publishStatus).toBe("published");
    expect(item?.body.scheduledAt).toBe("");
  });

  it("reports every missing translated body before creating items", () => {
    expect(() =>
      preparePublishItems(
        [
          chapter({ number: "1", translatedContent: null }),
          chapter({ number: "2", translatedContent: "   " }),
        ],
        { bookId: "destination", chapterPrice: 0, publishStatus: "draft" },
      ),
    ).toThrow("Selected chapters missing translated content: 1, 2");
  });

  it("rejects duplicate generated title-only names", () => {
    expect(() =>
      preparePublishItems([chapter(), chapter({ id: "second", number: "2" })], {
        bookId: "destination",
        chapterPrice: 0,
        publishStatus: "draft",
      }),
    ).toThrow("Selected chapters have duplicate generated titles: ชื่อตอน");
  });
});

describe("MyNovel destination preflight", () => {
  it.each([
    {
      name: "different book",
      book: { bookId: "other", bookName: "Other", category: "novel" },
      chapters: [],
      expected: "MyNovel returned a different destination book",
      expectedCalls: 1,
    },
    {
      name: "non-novel category",
      book: { bookId: "book-1", bookName: "Comic", category: "cartoon" },
      chapters: [],
      expected: "MyNovel destination must be a novel",
      expectedCalls: 1,
    },
    {
      name: "malformed chapter list",
      book: { bookId: "book-1", bookName: "Novel", category: "novel" },
      chapters: { chapterTitle: "not an array" },
      expected: "MyNovel returned a malformed chapter list",
      expectedCalls: 2,
    },
    {
      name: "existing exact title",
      book: { bookId: "book-1", bookName: "Novel", category: "novel" },
      chapters: [{ chapterTitle: "ชื่อตอน" }],
      expected: "MyNovel already contains chapter title(s): ชื่อตอน",
      expectedCalls: 2,
    },
  ])("aborts on $name before any POST", async (testCase) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(testCase.book))
      .mockResolvedValueOnce(jsonResponse(testCase.chapters));

    await expect(
      preflightMyNovelDestination("book-1", publishItems(), CREDENTIALS, fetchMock),
    ).rejects.toThrow(testCase.expected);

    expect(fetchMock).toHaveBeenCalledTimes(testCase.expectedCalls);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("uses owner endpoints so an unverified destination can pass preflight", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          bookId: "book-1",
          bookName: "ปลายทาง",
          category: "novel",
          status: "pending",
          isVerified: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ chapterTitle: "ตอนเก่า" }]));

    await expect(
      preflightMyNovelDestination("book-1", publishItems(), CREDENTIALS, fetchMock),
    ).resolves.toEqual({ bookName: "ปลายทาง", existingChapterCount: 1 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api-mynovel.co/api/books/book-1/owner",
      "https://api-mynovel.co/api/books/book-1/chapters/owner",
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers);
      const requestId = headers.get("X-Request-Id");
      const timestamp = headers.get("X-Request-Timestamp");
      expect(headers.get("Authorization")).toBe("Bearer test-token");
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(timestamp).toMatch(/^\d+$/);
      expect(headers.get("X-Request-Signature")).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("MyNovel sequential publication", () => {
  it("posts exact bodies one at a time in chapter order", async () => {
    const items = publishItems();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let responseNumber = 0;
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      responseNumber += 1;
      return jsonResponse({ chapterId: `remote-${responseNumber}` }, 201);
    });

    await expect(postChaptersSequentially(items, CREDENTIALS, fetchMock)).resolves.toEqual([
      "1",
      "2",
      "3",
    ]);

    expect(maxActiveRequests).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as unknown),
    ).toEqual(items.map((item) => item.body));
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "POST")).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith("[1/3] Created 1: ชื่อตอน -> remote-1");
  });

  it("stops after an ambiguous second POST failure without retrying or sending the third", async () => {
    const items = publishItems();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ chapterId: "remote-1" }, 201))
      .mockRejectedValueOnce(new Error("socket closed"));

    let caught: unknown;
    try {
      await postChaptersSequentially(items, CREDENTIALS, fetchMock);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ChapterPublishError);
    expect(caught).toMatchObject({
      completedNumbers: ["1"],
      failedNumber: "2",
      remainingNumbers: ["3"],
      outcomeUnknown: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
