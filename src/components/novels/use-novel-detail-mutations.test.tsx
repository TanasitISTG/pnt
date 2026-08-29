// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { useNovelDetailMutations } from "./use-novel-detail-mutations";
import * as chapterFunctions from "@/lib/content/chapter.functions";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/content/novel.functions", () => ({
  deleteNovel: vi.fn(),
  setNovelPublished: vi.fn(),
}));

vi.mock("@/lib/content/chapter.functions", () => ({
  deleteChapter: vi.fn(),
  reorderChapters: vi.fn(),
  setChapterPublished: vi.fn(),
  setAllChaptersPublished: vi.fn(),
}));

vi.mock("@/lib/content/chapter-ops.functions", () => ({
  deleteAllNovelTranslations: vi.fn(),
  translateMissingTitles: vi.fn(),
}));

describe("useNovelDetailMutations chapter publishing", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
  });

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  it("rejects a second publish until the active request settles", async () => {
    const firstPublish = Promise.withResolvers<{ id: string }>();
    vi.mocked(chapterFunctions.setChapterPublished).mockReturnValueOnce(
      firstPublish.promise as never,
    );
    const { result } = renderHook(() => useNovelDetailMutations("novel-1", vi.fn()), {
      wrapper,
    });

    act(() => {
      result.current.publishChapter({ chapterId: "chapter-1", publishedAt: new Date() });
    });
    await vi.waitFor(() => {
      expect(chapterFunctions.setChapterPublished).toHaveBeenCalledTimes(1);
    });
    act(() => {
      result.current.publishChapter({ chapterId: "chapter-2", publishedAt: new Date() });
    });

    expect(chapterFunctions.setChapterPublished).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Wait for the current publish update to finish");

    await act(async () => {
      firstPublish.resolve({ id: "chapter-1" });
      await Promise.resolve();
    });

    vi.mocked(chapterFunctions.setChapterPublished).mockResolvedValueOnce({
      id: "chapter-2",
    } as never);
    await act(async () => {
      result.current.publishChapter({ chapterId: "chapter-2", publishedAt: null });
      await Promise.resolve();
    });

    expect(chapterFunctions.setChapterPublished).toHaveBeenCalledTimes(2);
  });
});
