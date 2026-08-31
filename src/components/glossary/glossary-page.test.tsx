// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  glossaryNovelQueryOptions,
  glossaryStatsQueryOptions,
  glossaryTermsQueryOptions,
} from "@/lib/glossary/query";
import type { GlossaryListPage, GlossaryListRow, GlossaryListSearch } from "@/lib/glossary/schemas";

const defaultSearch: GlossaryListSearch = {
  q: "",
  category: "all",
  status: "approved",
  sort: "source",
  dir: "asc",
  page: 1,
  pageSize: 25,
};

const routerState = vi.hoisted(() => ({
  search: {
    q: "",
    category: "all",
    status: "approved",
    sort: "source",
    dir: "asc",
    page: 1,
    pageSize: 25,
  } as GlossaryListSearch,
  navigate: vi.fn(),
}));

const serverFunctions = vi.hoisted(() => ({
  getNovel: vi.fn(),
  getGlossaryStats: vi.fn(),
  listGlossaryTerms: vi.fn(),
  previewTermReplacement: vi.fn(),
  createGlossaryTerm: vi.fn(),
  updateGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(),
  deleteAllGlossaryTerms: vi.fn(),
  bulkImportGlossaryTerms: vi.fn(),
  approveGlossaryTerm: vi.fn(),
  approveAllPendingTerms: vi.fn(),
  rejectGlossaryTerm: vi.fn(),
  rejectAllPendingTerms: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  getRouteApi: () => ({
    useParams: () => ({ novelId: "novel-1" }),
    useSearch: () => routerState.search,
    useNavigate: () => routerState.navigate,
  }),
}));
vi.mock("@/lib/glossary/functions", () => serverFunctions);

import { GlossaryPage } from "@/components/glossary/glossary-page";
import { GlossaryTable } from "@/components/glossary/glossary-table";

const novel = {
  id: "novel-1",
  title: "Oversized Glossary",
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
const stats = { total: 84, approved: 76, pending: 5, rejected: 3 };

function createRow(index: number, status: GlossaryListRow["status"] = "approved"): GlossaryListRow {
  return {
    id: `term-${index}`,
    source: `Source ${String(index).padStart(2, "0")}`,
    target: `เป้าหมาย ${index}`,
    category: index % 2 === 0 ? "character" : "place",
    note: `Note ${index}`,
    status,
  };
}

const allRows = Array.from({ length: 76 }, (_, index) => createRow(index));
const mixedRows = [createRow(1, "approved"), createRow(2, "pending"), createRow(3, "rejected")];

function createPage(
  rows: GlossaryListRow[],
  rowCount = rows.length,
  page = 1,
  pageSize: GlossaryListSearch["pageSize"] = 25,
): GlossaryListPage {
  return { rows, rowCount, page, pageSize };
}

function renderGlossary(
  page: GlossaryListPage = createPage(allRows.slice(0, 25), 76),
  search: GlossaryListSearch = defaultSearch,
) {
  routerState.search = search;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(glossaryNovelQueryOptions("novel-1").queryKey, novel);
  queryClient.setQueryData(glossaryStatsQueryOptions("novel-1").queryKey, stats);
  queryClient.setQueryData(glossaryTermsQueryOptions("novel-1", search).queryKey, page);
  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading</p>}>
        <GlossaryPage />
      </Suspense>
    </QueryClientProvider>,
  );
  return queryClient;
}

function latestNavigation() {
  return routerState.navigate.mock.calls.at(-1)?.[0] as {
    replace: boolean;
    search: (previous: GlossaryListSearch) => GlossaryListSearch;
  };
}

beforeEach(() => {
  serverFunctions.listGlossaryTerms.mockResolvedValue(createPage(allRows.slice(0, 25), 76));
  serverFunctions.createGlossaryTerm.mockResolvedValue({ id: "created-term" });
  serverFunctions.updateGlossaryTerm.mockResolvedValue({ success: true });
  serverFunctions.deleteGlossaryTerm.mockResolvedValue({ success: true });
  serverFunctions.deleteAllGlossaryTerms.mockResolvedValue({ deleted: 1 });
  serverFunctions.bulkImportGlossaryTerms.mockResolvedValue({
    imported: 1,
    updated: 0,
    errors: [],
  });
  serverFunctions.approveGlossaryTerm.mockResolvedValue({ success: true });
  serverFunctions.approveAllPendingTerms.mockResolvedValue({ success: true });
  serverFunctions.rejectGlossaryTerm.mockResolvedValue({ success: true });
  serverFunctions.rejectAllPendingTerms.mockResolvedValue({ rejected: 1 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  routerState.search = defaultSearch;
});

describe("GlossaryPage list workspace", () => {
  it("renders one bounded page with server range and navigation", () => {
    renderGlossary();

    expect(screen.getAllByRole("row")).toHaveLength(26);
    expect(screen.getByText("1–25 of 76 terms")).toBeTruthy();
    expect(screen.getByText("Page 1 of 4")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(latestNavigation().replace).toBe(false);
    expect(latestNavigation().search(defaultSearch)).toMatchObject({ page: 2 });
  });

  it("keeps source and target columns required", () => {
    renderGlossary();

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Target" })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: "Category" })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "Note" })).toBeTruthy();
  });

  it("renders skeleton and placeholder loading states", () => {
    const actions = {
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onApprove: vi.fn(),
      onReject: vi.fn(),
      pending: false,
    };
    const { container, rerender } = render(
      <GlossaryTable
        query={{
          page: undefined,
          isPending: true,
          isFetching: true,
          isPlaceholderData: false,
          isError: false,
          error: null,
        }}
        search={defaultSearch}
        onRetry={vi.fn()}
        onSearchChange={vi.fn()}
        actions={actions}
      />,
    );

    expect(screen.getByRole("region", { name: "Glossary terms" }).getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(7);

    rerender(
      <GlossaryTable
        query={{
          page: createPage([createRow(1)], 76),
          isPending: false,
          isFetching: true,
          isPlaceholderData: true,
          isError: false,
          error: null,
        }}
        search={defaultSearch}
        onRetry={vi.fn()}
        onSearchChange={vi.fn()}
        actions={actions}
      />,
    );
    expect(screen.getByText("Loading glossary page…")).toBeTruthy();
    expect(screen.getByText("Source 01")).toBeTruthy();
  });

  it("debounces filters and replaces URL state for controls", async () => {
    vi.useFakeTimers();
    renderGlossary();

    fireEvent.change(screen.getByRole("textbox", { name: "Search glossary" }), {
      target: { value: "mountain" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(latestNavigation().replace).toBe(true);
    expect(latestNavigation().search(defaultSearch)).toMatchObject({ q: "mountain", page: 1 });

    fireEvent.click(screen.getByRole("combobox", { name: "Filter by category" }));
    fireEvent.pointerDown(screen.getByRole("option", { name: "Place" }), { pointerType: "mouse" });
    fireEvent.click(screen.getByRole("option", { name: "Place" }));
    expect(latestNavigation().search(defaultSearch)).toMatchObject({ category: "place", page: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Sort by Source" }));
    expect(latestNavigation().search(defaultSearch)).toMatchObject({ sort: "source", dir: "desc" });

    fireEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    fireEvent.pointerDown(screen.getByRole("option", { name: "50" }), { pointerType: "mouse" });
    fireEvent.click(screen.getByRole("option", { name: "50" }));
    expect(latestNavigation().search(defaultSearch)).toMatchObject({ pageSize: 50, page: 1 });
  });

  it("syncs a corrected server page after the response arrives", () => {
    renderGlossary(createPage(allRows.slice(0, 1), 76, 1), { ...defaultSearch, page: 4 });
    expect(latestNavigation().replace).toBe(true);
    expect(latestNavigation().search({ ...defaultSearch, page: 4 })).toMatchObject({ page: 1 });
  });

  it("shows pending review callout and novel-wide bulk counts", () => {
    renderGlossary();
    expect(screen.getByText("5 AI suggestions awaiting review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review suggestions" }));
    expect(latestNavigation().search(defaultSearch)).toMatchObject({
      q: "",
      category: "all",
      status: "pending",
      sort: "source",
      dir: "asc",
      page: 1,
    });

    cleanup();
    renderGlossary(createPage([createRow(2, "pending")], 5), {
      ...defaultSearch,
      status: "pending",
    });
    expect(screen.getByRole("button", { name: "Approve all 5 pending" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject all 5 pending" })).toBeTruthy();
  });
  it("shows status-specific row menus", () => {
    renderGlossary(createPage(mixedRows, 3), { ...defaultSearch, status: "all" });

    fireEvent.click(screen.getByRole("button", { name: "Actions for Source 01" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Actions for Source 02" }));
    expect(screen.getByRole("menuitem", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Reject" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Actions for Source 03" }));
    expect(screen.getByRole("menuitem", { name: "Restore" })).toBeTruthy();
  });

  it("opens add and edit dialogs and keeps replacement preview in one dialog", async () => {
    serverFunctions.previewTermReplacement.mockResolvedValue({ chapterCount: 2, occurrences: 4 });
    renderGlossary(createPage([createRow(1)]));

    fireEvent.click(screen.getByRole("button", { name: "Add term" }));
    expect(screen.getByRole("heading", { name: "Add glossary term" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Actions for Source 01" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit glossary term" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Target translation"), {
      target: { value: "ใหม่" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save term" }));
    await waitFor(() =>
      expect(screen.getByText("Replace this target in translated chapters?")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save glossary only" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace & save" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Edit glossary term" })).toBeTruthy();
  });

  it("associates glossary validation errors and hints with their controls", () => {
    renderGlossary(createPage([]));

    fireEvent.click(screen.getByRole("button", { name: "Add term" }));
    const submit = screen.getByRole("dialog").querySelector('button[type="submit"]');
    expect(submit).toBeTruthy();
    fireEvent.click(submit!);

    const source = screen.getByLabelText("Source term");
    const target = screen.getByLabelText("Target translation");
    const note = screen.getByLabelText("Note");
    expect(source.getAttribute("aria-describedby")).toBe("glossary-source-error");
    expect(target.getAttribute("aria-describedby")).toBe("glossary-target-error");
    expect(note.getAttribute("aria-describedby")).toBe("glossary-note-hint");
    expect(screen.getByText("Source term is required").getAttribute("role")).toBe("alert");
    expect(screen.getByText("Target term is required").getAttribute("role")).toBe("alert");
  });

  it("submits both replacement choices with explicit chapter behavior", async () => {
    serverFunctions.previewTermReplacement.mockResolvedValue({ chapterCount: 2, occurrences: 4 });

    const submitChoice = async (
      choice: "Save glossary only" | "Replace & save",
      apply: boolean,
    ) => {
      const target = apply ? "ใหม่พร้อมบท" : "ใหม่เฉพาะอภิธานศัพท์";
      renderGlossary(createPage([createRow(1)]));
      fireEvent.click(screen.getByRole("button", { name: "Actions for Source 01" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("Target translation"), { target: { value: target } });
      fireEvent.click(screen.getByRole("button", { name: "Save term" }));
      await waitFor(() =>
        expect(screen.getByText("Replace this target in translated chapters?")).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole("button", { name: choice }));
      await waitFor(() =>
        expect(serverFunctions.updateGlossaryTerm).toHaveBeenCalledWith({
          data: expect.objectContaining({
            termId: "term-1",
            target,
            applyToChapters: apply,
          }),
        }),
      );
      cleanup();
      serverFunctions.updateGlossaryTerm.mockClear();
    };

    await submitChoice("Save glossary only", false);
    await submitChoice("Replace & save", true);
  });

  it("distinguishes filtered empty results and renders a retry state", async () => {
    renderGlossary(createPage([], 0), { ...defaultSearch, q: "missing" });
    expect(screen.getByText("No terms match these filters")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(2);

    cleanup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(glossaryNovelQueryOptions("novel-1").queryKey, novel);
    queryClient.setQueryData(glossaryStatsQueryOptions("novel-1").queryKey, stats);
    serverFunctions.listGlossaryTerms.mockRejectedValueOnce(new Error("Network down"));
    render(
      <QueryClientProvider client={queryClient}>
        <GlossaryPage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
  });
});
