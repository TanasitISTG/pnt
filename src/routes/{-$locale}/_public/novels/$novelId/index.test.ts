import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverFunctions = vi.hoisted(() => ({
  getNovel: vi.fn(),
  getAdminNovelDetailCore: vi.fn(),
  listChapters: vi.fn(),
  getReaderNovelState: vi.fn(),
}));

vi.mock("@/components/novels/detail/novel-public-page", () => ({
  NovelPublicPage: () => null,
}));
vi.mock("@/components/novels/detail/novel-detail-pending", () => ({
  NovelPending: () => null,
}));
vi.mock("@/lib/content/novel/novel.functions", () => ({
  getNovel: serverFunctions.getNovel,
  getAdminNovelDetailCore: serverFunctions.getAdminNovelDetailCore,
}));
vi.mock("@/lib/content/chapter/chapter.functions", () => ({
  listChapters: serverFunctions.listChapters,
}));
vi.mock("@/lib/reader/reader.functions", () => ({
  getReaderNovelState: serverFunctions.getReaderNovelState,
}));

import { Route } from "./index";

const novel = {
  id: "novel-1",
  title: "Dawn",
  sourceLang: "en",
  targetLang: "th",
  canManage: false,
};

async function invokeLoader(user: unknown = null) {
  const loader = Route.options.loader;
  if (typeof loader !== "function") throw new Error("Reading route loader is missing");
  try {
    return await loader({
      context: {
        user,
        queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      },
      params: { novelId: "novel-1" },
    } as never);
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // The real chapter read refuses with this sentence for a novel that is gone or private,
  // which is the failure that used to turn a missing page into a broken one.
  serverFunctions.listChapters.mockRejectedValue(new Error("Novel not found or unauthorized"));
  serverFunctions.getReaderNovelState.mockRejectedValue(
    new Error("Novel not found or unauthorized"),
  );
  serverFunctions.getAdminNovelDetailCore.mockResolvedValue(null);
});

describe("reading route loader", () => {
  it("serves a readable novel with its chapters and progress", async () => {
    serverFunctions.getNovel.mockResolvedValue(novel);
    serverFunctions.listChapters.mockResolvedValue([]);

    const result = await invokeLoader();

    expect(result).toEqual({ novel: expect.objectContaining({ id: "novel-1" }) });
  });

  it("reads a novel nobody may read as a missing page, not as a failure", async () => {
    serverFunctions.getNovel.mockResolvedValue(null);

    const error = await invokeLoader();

    // The owner read, the chapter read and the progress read all refuse here. None of them
    // is the page's problem: the novel's own answer is, and it is "not found".
    expect(isNotFound(error)).toBe(true);
  });

  it("still fails when the chapters of a novel that exists cannot be read", async () => {
    serverFunctions.getNovel.mockResolvedValue(novel);

    const error = await invokeLoader();

    expect(isNotFound(error)).toBe(false);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Novel not found or unauthorized");
  });

  it("carries a signed-in reader's own progress read, and a guest's local one", async () => {
    serverFunctions.getNovel.mockResolvedValue(novel);
    serverFunctions.listChapters.mockResolvedValue([]);
    serverFunctions.getReaderNovelState.mockResolvedValue({ progress: null, bookmarks: [] });

    await invokeLoader({ id: "user-1" });
    expect(serverFunctions.getReaderNovelState).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    serverFunctions.getNovel.mockResolvedValue(novel);
    serverFunctions.listChapters.mockResolvedValue([]);
    await invokeLoader(null);
    // Nothing of a guest's reading lives on the server, so the route must not ask for it.
    expect(serverFunctions.getReaderNovelState).not.toHaveBeenCalled();
  });
});
