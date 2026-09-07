import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const serverFunctions = vi.hoisted(() => ({
  getNovel: vi.fn(),
  getRelationshipMap: vi.fn(),
  getRelationshipWorkspace: vi.fn(),
}));

vi.mock("@/components/relationships/relationships-page", () => ({
  RelationshipsPage: () => null,
}));
vi.mock("@/lib/content/novel.functions", () => ({ getNovel: serverFunctions.getNovel }));
vi.mock("@/lib/relationships/functions", () => ({
  getRelationshipMap: serverFunctions.getRelationshipMap,
  getRelationshipWorkspace: serverFunctions.getRelationshipWorkspace,
}));

import { Route } from "@/routes/_protected/novels/$novelId/relationships";

const emptyMap = { version: 1 as const, characters: [], relationships: [] };

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
}

async function invokeLoader(
  pair: { sourceLang: string; targetLang: string } | null,
  queryClient = createQueryClient(),
) {
  const novel = pair
    ? {
        id: "novel-1",
        title: "Route fixture",
        originalTitle: null,
        author: null,
        description: null,
        sourceLang: pair.sourceLang,
        targetLang: pair.targetLang,
        customPrompt: null,
        chunkSize: 2_000,
        contextTailLength: 500,
        publishedAt: null,
        hasCover: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      }
    : null;
  const supported = pair
    ? ["en->th", "zh->en", "zh->th"].includes(`${pair.sourceLang}->${pair.targetLang}`)
    : false;
  serverFunctions.getRelationshipWorkspace.mockResolvedValue(
    novel ? { novel, map: supported ? emptyMap : null } : null,
  );
  const loader = Route.options.loader;
  if (typeof loader !== "function") throw new Error("Relationship route loader is missing");
  try {
    await loader({
      context: { queryClient },
      params: { novelId: "novel-1" },
    } as never);
    return null;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("relationship route data ownership", () => {
  it("loads the map for every canonical language pair", async () => {
    for (const pair of [
      { sourceLang: "en", targetLang: "th" },
      { sourceLang: "zh", targetLang: "en" },
      { sourceLang: "zh", targetLang: "th" },
    ]) {
      const error = await invokeLoader(pair);
      expect(error).toBeNull();
      expect(serverFunctions.getRelationshipWorkspace).toHaveBeenCalledTimes(1);
      expect(serverFunctions.getNovel).not.toHaveBeenCalled();
      expect(serverFunctions.getRelationshipMap).not.toHaveBeenCalled();
      vi.clearAllMocks();
    }
  });

  it.each([
    ["missing novel", null],
    ["unsupported pair", { sourceLang: "en", targetLang: "en" }],
  ])("redirects before requesting the map for a %s", async (_label, pair) => {
    const error = await invokeLoader(pair);

    expect(isRedirect(error)).toBe(true);
    if (!isRedirect(error)) return;
    expect(error.options.to).toBe("/novels/$novelId");
    expect(serverFunctions.getRelationshipWorkspace).toHaveBeenCalledTimes(1);
    expect(serverFunctions.getRelationshipMap).not.toHaveBeenCalled();
  });
  it("does not admit an unsupported pair from a fresh-looking cache", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["novel", "novel-1"], {
      id: "novel-1",
      sourceLang: "zh",
      targetLang: "th",
    });
    queryClient.setQueryData(["relationshipMap", "novel-1"], {
      version: 1,
      characters: [{ stale: true }],
      relationships: [],
    });
    queryClient.setQueryData(
      ["relationshipWorkspace", "novel-1"],
      {
        novel: { id: "novel-1", sourceLang: "zh", targetLang: "th" },
        map: { version: 1, characters: [{ stale: true }], relationships: [] },
      },
      { updatedAt: 1 },
    );

    const error = await invokeLoader({ sourceLang: "en", targetLang: "en" }, queryClient);

    expect(isRedirect(error)).toBe(true);
    expect(serverFunctions.getRelationshipWorkspace).toHaveBeenCalledTimes(1);
    expect(serverFunctions.getNovel).not.toHaveBeenCalled();
    expect(serverFunctions.getRelationshipMap).not.toHaveBeenCalled();
  });
  it("refreshes a cached map before admitting a supported pair", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["novel", "novel-1"], {
      id: "novel-1",
      sourceLang: "zh",
      targetLang: "en",
    });
    queryClient.setQueryData(["relationshipMap", "novel-1"], {
      version: 1,
      characters: [{ stale: true }],
      relationships: [],
    });
    queryClient.setQueryData(
      ["relationshipWorkspace", "novel-1"],
      {
        novel: { id: "novel-1", sourceLang: "zh", targetLang: "th" },
        map: { version: 1, characters: [{ stale: true }], relationships: [] },
      },
      { updatedAt: 1 },
    );

    const error = await invokeLoader({ sourceLang: "zh", targetLang: "en" }, queryClient);

    expect(error).toBeNull();
    expect(serverFunctions.getRelationshipWorkspace).toHaveBeenCalledTimes(1);
    expect(serverFunctions.getRelationshipMap).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["relationshipMap", "novel-1"])).toEqual(emptyMap);
  });

  it("hydrates without reloading from search dependencies", () => {
    expect(Route.options.shouldReload).toBe(false);
    expect(Route.options.loaderDeps?.({ search: { view: "characters" } } as never)).toEqual({});
  });
});
