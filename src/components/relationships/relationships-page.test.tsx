// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  relationshipMapQueryOptions,
  relationshipNovelQueryOptions,
  type RelationshipMapSearch,
} from "@/lib/relationships/query";
import type {
  CharacterProfile,
  CharacterRelationship,
  RelationshipMapV1,
} from "@/lib/relationships/schemas";

const defaultSearch: RelationshipMapSearch = {
  view: "characters",
  q: "",
  state: "all",
  management: "all",
  sort: "name",
  dir: "asc",
  page: 1,
  pageSize: 25,
};

const routerState = vi.hoisted(() => ({
  search: {
    view: "characters",
    q: "",
    state: "all",
    management: "all",
    sort: "name",
    dir: "asc",
    page: 1,
    pageSize: 25,
  } as RelationshipMapSearch,
  navigate: vi.fn(),
}));

const serverFunctions = vi.hoisted(() => ({
  getNovel: vi.fn(),
  getRelationshipMap: vi.fn(),
  upsertCharacterProfile: vi.fn(),
  upsertCharacterRelationship: vi.fn(),
  setRelationshipEntryEnabled: vi.fn(),
  setRelationshipEntryAutoManaged: vi.fn(),
  deleteRelationshipEntry: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  getRouteApi: () => ({
    useParams: () => ({ novelId: "novel-relationships" }),
    useSearch: () => routerState.search,
    useNavigate: () => routerState.navigate,
  }),
}));
vi.mock("@/lib/relationships/functions", () => serverFunctions);

import { RelationshipsPage } from "@/components/relationships/relationships-page";

const novel = {
  id: "novel-relationships",
  title: "Relationship Fixture",
  originalTitle: null,
  author: null,
  description: null,
  sourceLang: "zh" as const,
  targetLang: "th" as const,
  customPrompt: null,
  chunkSize: 2_000,
  contextTailLength: 1_000,
  publishedAt: null,
  hasCover: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function createCharacter(index: number): CharacterProfile {
  return {
    id: `character-${index}`,
    sourceName: `Character ${String(index).padStart(2, "0")}`,
    targetName: `ตัวละคร ${index}`,
    aliases: [`Alias ${index}`],
    gender: index % 2 === 0 ? "male" : "female",
    role: `Role ${index}`,
    notes: `Character note ${index}`,
    evidence: `Character evidence ${index}`,
    enabled: index % 4 !== 0,
    locked: index % 2 === 0,
    lastSeenChapter: index + 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createRelationship(index: number, characters: CharacterProfile[]): CharacterRelationship {
  const speakerIndex = index % characters.length;
  const listenerIndex = (speakerIndex + 1) % characters.length;
  return {
    id: `relationship-${index}`,
    speakerId: characters[speakerIndex].id,
    listenerId: characters[listenerIndex].id,
    relationship: `Bond ${index}`,
    speakerStatus: index % 2 === 0 ? "peer" : "higher",
    familiarity: index % 2 === 0 ? "close" : "distant",
    selfPronoun: `self-${index}`,
    addresseeTerm: `title-${index}`,
    sentenceParticles: `particle-${index}`,
    register: `register-${index}`,
    notes: `Relationship note ${index}`,
    evidence: `Relationship evidence ${index}`,
    enabled: index % 3 !== 0,
    locked: index % 2 === 0,
    lastSeenChapter: index + 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const characters = Array.from({ length: 30 }, (_, index) => createCharacter(index));
const relationships = Array.from({ length: 36 }, (_, index) =>
  createRelationship(index, characters),
);
const map: RelationshipMapV1 = { version: 1, characters, relationships };

function renderRelationships(
  search: RelationshipMapSearch = defaultSearch,
  relationshipMap: RelationshipMapV1 = map,
) {
  routerState.search = search;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(relationshipNovelQueryOptions("novel-relationships").queryKey, novel);
  queryClient.setQueryData(
    relationshipMapQueryOptions("novel-relationships").queryKey,
    relationshipMap,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading</p>}>
        <RelationshipsPage />
      </Suspense>
    </QueryClientProvider>,
  );
  return queryClient;
}

function latestNavigation() {
  return routerState.navigate.mock.calls.at(-1)?.[0] as {
    replace: boolean;
    search: (previous: RelationshipMapSearch) => RelationshipMapSearch;
  };
}

beforeEach(() => {
  serverFunctions.getRelationshipMap.mockResolvedValue(map);
  serverFunctions.upsertCharacterProfile.mockResolvedValue({ id: "new-character" });
  serverFunctions.upsertCharacterRelationship.mockResolvedValue({ id: "new-relationship" });
  serverFunctions.setRelationshipEntryEnabled.mockResolvedValue({ success: true });
  serverFunctions.setRelationshipEntryAutoManaged.mockResolvedValue({ success: true });
  serverFunctions.deleteRelationshipEntry.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  routerState.search = defaultSearch;
});

describe("RelationshipsPage workspace", () => {
  it("bounds the active character list and renders one panel at a time", () => {
    renderRelationships();

    expect(screen.getByText("1–25 of 30 characters")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Characters \(30\)/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Directed relationships \(36\)/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Characters" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Directed relationships" })).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(26);

    fireEvent.click(screen.getByRole("tab", { name: /Directed relationships \(36\)/ }));
    expect(latestNavigation().replace).toBe(true);
    expect(latestNavigation().search(defaultSearch)).toMatchObject({
      view: "relationships",
      q: "",
      state: "all",
      management: "all",
      sort: "name",
      dir: "asc",
      page: 1,
      pageSize: 25,
    });
  });

  it("disables all relationship creation actions until two characters exist", () => {
    renderRelationships(
      { ...defaultSearch, view: "relationships" },
      { version: 1, characters: [], relationships: [] },
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Add directed relationship",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /^Add relationship$/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Add at least 2 character profiles first.")).toBeTruthy();
  });

  it("filters, sorts, slices, and corrects client pagination", async () => {
    renderRelationships({ ...defaultSearch, q: "Character 01" });
    expect(screen.getByText("1–1 of 1 characters")).toBeTruthy();

    cleanup();
    renderRelationships({ ...defaultSearch, sort: "name", dir: "desc" });
    expect(screen.getByText("Character 29")).toBeTruthy();

    cleanup();
    renderRelationships({ ...defaultSearch, page: 2 });
    expect(screen.getByText("26–30 of 30 characters")).toBeTruthy();

    cleanup();
    renderRelationships({ ...defaultSearch, q: "does-not-exist", page: 2 });
    expect(screen.getByText("No character profiles match these filters.")).toBeTruthy();
    await waitFor(() =>
      expect(
        latestNavigation().search({ ...defaultSearch, q: "does-not-exist", page: 2 }),
      ).toMatchObject({ page: 1 }),
    );
  });

  it("corrects the URL page after a deletion-sized map shrink", async () => {
    const search = { ...defaultSearch, page: 2 };
    const queryClient = renderRelationships(search);
    routerState.navigate.mockClear();

    await act(async () => {
      queryClient.setQueryData(relationshipMapQueryOptions("novel-relationships").queryKey, {
        ...map,
        characters: map.characters.slice(0, 10),
        relationships: [],
      });
    });

    await waitFor(() => {
      const navigation = latestNavigation();
      expect(navigation.replace).toBe(true);
      expect(navigation.search(search)).toMatchObject({ page: 1 });
    });
  });

  it("applies state and management filters and supports column visibility", () => {
    renderRelationships({ ...defaultSearch, state: "active", management: "manual" });
    expect(screen.getByText("1–7 of 7 characters")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Notes / evidence" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Notes / evidence" }));
    expect(screen.getByText("Character note 2")).toBeTruthy();
  });

  it("opens row actions and scroll-safe add/edit dialogs with full relationship options", async () => {
    renderRelationships();

    fireEvent.click(screen.getByRole("button", { name: "Add character profile" }));
    expect(screen.getByRole("heading", { name: "Add character profile" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "New Hero" } });
    fireEvent.change(screen.getByLabelText("Thai name"), { target: { value: "ฮีโร่ใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "Save character" }));
    await waitFor(() =>
      expect(serverFunctions.upsertCharacterProfile).toHaveBeenCalledWith({
        data: {
          id: undefined,
          novelId: "novel-relationships",
          sourceName: "New Hero",
          targetName: "ฮีโร่ใหม่",
          aliases: [],
          gender: "unknown",
          role: null,
          notes: null,
          evidence: null,
        },
      }),
    );

    cleanup();
    renderRelationships();
    fireEvent.click(screen.getByRole("button", { name: "Actions for character Character 02" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Disable" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Use automatic updates" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit character profile" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close character profile dialog" }));
    fireEvent.click(screen.getByRole("tab", { name: /Directed relationships \(36\)/ }));
    cleanup();
    routerState.search = { ...defaultSearch, view: "relationships" };
    renderRelationships(routerState.search);
    fireEvent.click(screen.getByRole("button", { name: "Add directed relationship" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Speaker" }));
    expect(screen.getByRole("option", { name: /Character 29/ })).toBeTruthy();
  }, 15_000);

  it("sends exact row-action and relationship-edit payloads", async () => {
    renderRelationships();
    fireEvent.click(screen.getByRole("button", { name: "Actions for character Character 02" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    await waitFor(() =>
      expect(serverFunctions.setRelationshipEntryEnabled).toHaveBeenCalledWith({
        data: {
          novelId: "novel-relationships",
          entryType: "character",
          entryId: "character-2",
          enabled: false,
        },
      }),
    );

    cleanup();
    renderRelationships();
    fireEvent.click(screen.getByRole("button", { name: "Actions for character Character 02" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Use automatic updates" }));
    await waitFor(() =>
      expect(serverFunctions.setRelationshipEntryAutoManaged).toHaveBeenCalledWith({
        data: {
          novelId: "novel-relationships",
          entryType: "character",
          entryId: "character-2",
        },
      }),
    );

    cleanup();
    renderRelationships();
    fireEvent.click(screen.getByRole("button", { name: "Actions for character Character 02" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete relationship entry" }));
    await waitFor(() =>
      expect(serverFunctions.deleteRelationshipEntry).toHaveBeenCalledWith({
        data: {
          novelId: "novel-relationships",
          entryType: "character",
          entryId: "character-2",
        },
      }),
    );

    cleanup();
    renderRelationships({ ...defaultSearch, view: "relationships" });
    fireEvent.click(
      screen
        .getAllByRole("button", {
          name: "Actions for relationship Character 00 to Character 01",
        })
        .at(0)!,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Relationship"), { target: { value: "Sibling" } });
    fireEvent.click(screen.getByRole("button", { name: "Save relationship" }));
    await waitFor(() =>
      expect(serverFunctions.upsertCharacterRelationship).toHaveBeenCalledWith({
        data: {
          novelId: "novel-relationships",
          id: "relationship-0",
          speakerId: "character-0",
          listenerId: "character-1",
          relationship: "Sibling",
          speakerStatus: "peer",
          familiarity: "close",
          selfPronoun: "self-0",
          addresseeTerm: "title-0",
          sentenceParticles: "particle-0",
          register: "register-0",
          notes: "Relationship note 0",
          evidence: "Relationship evidence 0",
        },
      }),
    );
  }, 15_000);

  it("keeps stale rows visible with a refresh error and retry", async () => {
    const queryClient = renderRelationships();
    await waitFor(() => expect(screen.getByText("Character 00")).toBeTruthy());
    serverFunctions.getRelationshipMap.mockRejectedValueOnce(new Error("Refresh unavailable"));

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: relationshipMapQueryOptions("novel-relationships").queryKey,
      });
    });
    expect(
      queryClient.getQueryState(relationshipMapQueryOptions("novel-relationships").queryKey),
    ).toMatchObject({ status: "error", data: map });

    await waitFor(() =>
      expect(screen.getByText("Unable to refresh relationship map")).toBeTruthy(),
    );
    expect(screen.getByText("Character 00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByText("Unable to refresh relationship map")).toBeNull(),
    );
  });

  it("keeps relationship empty and map error states actionable", async () => {
    const emptyMap = { ...map, relationships: [] };
    renderRelationships({ ...defaultSearch, view: "relationships" }, emptyMap);
    expect(screen.getByText(/No directed relationships yet\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add relationship" })).toBeTruthy();

    cleanup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(relationshipNovelQueryOptions("novel-relationships").queryKey, novel);
    serverFunctions.getRelationshipMap.mockRejectedValueOnce(new Error("Map unavailable"));
    render(
      <QueryClientProvider client={queryClient}>
        <RelationshipsPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
  });
});
