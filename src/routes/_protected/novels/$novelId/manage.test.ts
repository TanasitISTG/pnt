import { QueryClient } from "@tanstack/react-query";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverFunctions = vi.hoisted(() => ({
  getNovel: vi.fn(),
  setNovelPublished: vi.fn(),
}));

vi.mock("@/components/studio/studio-shell", () => ({ StudioShell: () => null }));
vi.mock("@/components/novels/use-novel-publish-state", () => ({
  useNovelPublishState: () => ({ publishing: false, setPublishedAt: vi.fn() }),
}));
vi.mock("@/lib/content/novel/novel.functions", () => ({
  getNovel: serverFunctions.getNovel,
  setNovelPublished: serverFunctions.setNovelPublished,
}));

import { Route } from "@/routes/_protected/novels/$novelId/manage";

function novelFixture(canManage: boolean) {
  return {
    id: "novel-1",
    title: "Studio fixture",
    originalTitle: null,
    author: null,
    description: null,
    sourceLang: "en" as const,
    targetLang: "th" as const,
    customPrompt: null,
    chunkSize: 2_000,
    contextTailLength: 500,
    publishedAt: null,
    hasCover: false,
    coverUrl: null,
    coverSrcSet: null,
    canManage,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

async function invokeLoader(novel: ReturnType<typeof novelFixture> | null) {
  serverFunctions.getNovel.mockResolvedValue(novel);
  const loader = Route.options.loader;
  if (typeof loader !== "function") throw new Error("Studio route loader is missing");
  try {
    return await loader({
      context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      params: { novelId: "novel-1" },
    } as never);
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("studio route ownership", () => {
  it("admits the owner with the novel it will frame every section with", async () => {
    const result = await invokeLoader(novelFixture(true));

    expect(result).toEqual({ novel: expect.objectContaining({ id: "novel-1" }) });
  });

  it("sends a signed-in reader who does not own the novel to its reading page", async () => {
    const error = await invokeLoader(novelFixture(false));

    expect(isRedirect(error)).toBe(true);
    if (!isRedirect(error)) return;
    expect(error.options.to).toBe("/{-$locale}/novels/$novelId");
    expect(error.options.params).toEqual({ novelId: "novel-1" });
  });

  it("does not open a studio for a novel that does not exist", async () => {
    const error = await invokeLoader(null);

    expect(isRedirect(error)).toBe(false);
    expect(isNotFound(error)).toBe(true);
  });
});
