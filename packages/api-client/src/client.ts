import { z, type ZodType } from "zod";
import {
  chapterBodyV1Schema,
  chapterManifestV1Schema,
  chapterSummaryV1Schema,
  novelDetailV1Schema,
  novelListV1Schema,
} from "@pnt/contracts/content";
import {
  bookmarkCreatedV1Schema,
  bookmarkPageV1Schema,
  readerStateV1Schema,
  successV1Schema,
  type CreateBookmarkV1,
} from "@pnt/contracts/reader-api";
import { apiErrorV1Schema, type ApiErrorCodeV1 } from "@pnt/contracts/api-error";
import type { ReaderBookmarkCursor } from "@pnt/contracts/reader";

export class PntApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCodeV1,
    message: string,
  ) {
    super(message);
    this.name = "PntApiError";
  }
}

type RequestBody = CreateBookmarkV1 | { scrollFraction: number } | { note: string | null };

export type PntApiClient = ReturnType<typeof createPntApiClient>;
export function createPntApiClient(options: {
  baseUrl: string;
  getCookie?: () => string | null | undefined | Promise<string | null | undefined>;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  let url: URL;
  try {
    url = new URL(options.baseUrl);
  } catch {
    throw new Error("API base URL must be an absolute HTTP(S) origin without a trailing slash");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== options.baseUrl ||
    options.baseUrl.endsWith("/")
  ) {
    throw new Error("API base URL must be an absolute HTTP(S) origin without a trailing slash");
  }
  const fetcher = options.fetchImpl ?? fetch;
  const novelPath = (novelId: string) => `/api/v1/novels/${encodeURIComponent(novelId)}`;
  const chapterPath = (novelId: string, chapterId: string) =>
    `${novelPath(novelId)}/chapters/${encodeURIComponent(chapterId)}`;

  async function send(path: string, method = "GET", body?: RequestBody): Promise<Response> {
    const headers = new Headers();
    if (method !== "GET" && method !== "HEAD") headers.set("Content-Type", "application/json");
    const cookie = await options.getCookie?.();
    if (cookie) headers.set("Cookie", cookie);
    return fetcher(`${options.baseUrl}${path}`, {
      method,
      headers,
      credentials: "omit",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function checked(response: Response): Promise<Response> {
    if (!response.ok) {
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        /* Non-JSON upstream errors are generic. */
      }
      const parsed = apiErrorV1Schema.safeParse(json);
      if (parsed.success)
        throw new PntApiError(response.status, parsed.data.error.code, parsed.data.error.message);
      throw new PntApiError(response.status, "INTERNAL_ERROR", "Unexpected API response");
    }
    return response;
  }

  async function read<T>(
    path: string,
    schema: ZodType<T>,
    method = "GET",
    body?: RequestBody,
  ): Promise<T> {
    const response = await checked(await send(path, method, body));
    try {
      return schema.parse(await response.json());
    } catch {
      throw new PntApiError(response.status, "INTERNAL_ERROR", "Unexpected API response");
    }
  }

  return {
    listNovels: () => read("/api/v1/novels", z.array(novelListV1Schema)),
    getNovel: (novelId: string) => read(novelPath(novelId), novelDetailV1Schema),
    listChapters: (novelId: string) =>
      read(`${novelPath(novelId)}/chapters`, z.array(chapterSummaryV1Schema)),
    getManifest: (novelId: string) =>
      read(`${novelPath(novelId)}/manifest`, chapterManifestV1Schema),
    getChapter: (novelId: string, chapterId: string) =>
      read(chapterPath(novelId, chapterId), chapterBodyV1Schema),
    getCover: (novelId: string, width: 320 | 480 | 640) =>
      send(`${novelPath(novelId)}/cover?w=${width}`).then(checked),
    getReaderState: (novelId: string) =>
      read(`${novelPath(novelId)}/reader-state`, readerStateV1Schema),
    listBookmarks: (novelId: string, cursor: ReaderBookmarkCursor | null = null) => {
      const query = new URLSearchParams();
      if (cursor) {
        query.set("cursorCreatedAt", cursor.createdAt);
        query.set("cursorId", cursor.id);
      }
      return read(
        `${novelPath(novelId)}/bookmarks${cursor ? `?${query}` : ""}`,
        bookmarkPageV1Schema,
      );
    },
    addBookmark: (novelId: string, input: CreateBookmarkV1) =>
      read(`${novelPath(novelId)}/bookmarks`, bookmarkCreatedV1Schema, "POST", input),
    openChapter: (novelId: string, chapterId: string) =>
      read(`${chapterPath(novelId, chapterId)}/open`, successV1Schema, "POST"),
    savePosition: (novelId: string, chapterId: string, scrollFraction: number) =>
      read(`${chapterPath(novelId, chapterId)}/position`, successV1Schema, "PUT", {
        scrollFraction,
      }),
    markRead: (novelId: string, chapterId: string) =>
      read(`${chapterPath(novelId, chapterId)}/read`, successV1Schema, "POST"),
    editBookmarkNote: (bookmarkId: string, note: string | null) =>
      read(`/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}`, successV1Schema, "PATCH", {
        note,
      }),
    removeBookmark: (bookmarkId: string) =>
      read(`/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}`, successV1Schema, "DELETE"),
  };
}
