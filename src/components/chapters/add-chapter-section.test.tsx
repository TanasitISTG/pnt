// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChapter } from "@/lib/content/chapter.functions";
import { AddChapterSection } from "./add-chapter-section";

vi.mock("@/lib/content/chapter.functions", () => ({
  createChapter: vi.fn().mockResolvedValue({ id: "chapter-new" }),
}));

const importMocks = vi.hoisted(() => ({
  useImportJob: vi.fn(),
}));

vi.mock("./use-import-job", () => ({
  useImportJob: importMocks.useImportJob,
}));

function createImportController() {
  return {
    importJob: null,
    importActive: false,
    initialStatusLoading: false,
    startPending: false,
    startImport: vi.fn(),
    cancelImport: vi.fn(),
    attachJob: vi.fn(),
    importStatusError: null,
    retryImportStatus: vi.fn(),
    canRetryImport: false,
    retryImport: vi.fn(),
  };
}
interface MockChapterFetched {
  number: string;
  title: string;
  content: string;
  sourceUrl: string;
}

interface MockImportController {
  importActive: boolean;
  startPending: boolean;
  initialStatusLoading: boolean;
}

interface MockScrapeImportSectionProps {
  onChapterFetched: (chapter: MockChapterFetched) => void;
  importController: MockImportController;
  bulkStartDisabled: boolean;
  otherImportActive: boolean;
}

function MockScrapeImportSection({
  onChapterFetched,
  importController,
  bulkStartDisabled,
  otherImportActive,
}: MockScrapeImportSectionProps) {
  const [url, setUrl] = useState("");

  return (
    <div>
      <label htmlFor="mock-scrape-url">URL draft</label>
      <input id="mock-scrape-url" value={url} onChange={(event) => setUrl(event.target.value)} />
      <button
        type="button"
        onClick={() =>
          onChapterFetched({
            number: "7",
            title: "Fetched chapter",
            content: "Fetched content",
            sourceUrl: "https://example.test/chapter-7",
          })
        }
      >
        Preview URL
      </button>
      <button
        type="button"
        disabled={
          bulkStartDisabled ||
          importController.importActive ||
          importController.startPending ||
          otherImportActive
        }
      >
        Start URL range
      </button>
    </div>
  );
}

interface MockEpubImportSectionProps {
  importController: MockImportController;
  bulkStartDisabled: boolean;
  otherImportActive: boolean;
}
function MockEpubImportSection({
  importController,
  bulkStartDisabled,
  otherImportActive,
}: MockEpubImportSectionProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  return (
    <div>
      <label htmlFor="mock-epub-file">EPUB file</label>
      <input
        id="mock-epub-file"
        type="file"
        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={
          bulkStartDisabled ||
          importController.importActive ||
          importController.startPending ||
          otherImportActive
        }
        onClick={() => setUploadProgress(42)}
      >
        Start upload
      </button>
      <span>{selectedFile ? `Selected: ${selectedFile.name}` : "No file selected"}</span>
      <span>Upload progress: {uploadProgress}%</span>
    </div>
  );
}

vi.mock("./scrape-import-section", () => ({
  ScrapeImportSection: MockScrapeImportSection,
}));
vi.mock("./epub-import-section", () => ({
  EpubImportSection: MockEpubImportSection,
}));

const BASE_CHAPTERS = [{ number: "1" }];

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function AddChapterHarness({
  chapters,
  queryClient,
}: {
  chapters: Array<{ number: string }>;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <AddChapterSection novelId="novel-1" chapters={chapters} invalidateChapters={vi.fn()} />
    </QueryClientProvider>
  );
}

function renderAddChapter(chapters = BASE_CHAPTERS) {
  const queryClient = createQueryClient();
  return {
    queryClient,
    ...render(<AddChapterHarness chapters={chapters} queryClient={queryClient} />),
  };
}

function getChapterNumberInput() {
  return document.getElementById("chapNumber") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddChapterSection", () => {
  beforeEach(() => {
    importMocks.useImportJob.mockImplementation(() => createImportController());
    vi.mocked(createChapter).mockResolvedValue({ id: "chapter-new" });
  });

  it("keeps manual, URL, and EPUB panel state mounted across mode switches", () => {
    renderAddChapter();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Chapter number *" }), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Chapter title *" }), {
      target: { value: "Manual draft" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Source text *" }), {
      target: { value: "Manual content" },
    });

    fireEvent.click(screen.getByRole("tab", { name: /^From URL/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "URL draft" }), {
      target: { value: "https://example.test/chapter-4" },
    });

    fireEvent.click(screen.getByRole("tab", { name: /^EPUB file/ }));
    const file = new File(["epub"], "chapter-4.epub", { type: "application/epub+zip" });
    fireEvent.change(screen.getByLabelText("EPUB file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Start upload" }));

    fireEvent.click(screen.getByRole("tab", { name: /^Paste text/ }));
    expect(
      (screen.getByRole("spinbutton", { name: "Chapter number *" }) as HTMLInputElement).value,
    ).toBe("4");
    expect(
      (screen.getByRole("textbox", { name: "Chapter title *" }) as HTMLInputElement).value,
    ).toBe("Manual draft");
    expect((screen.getByRole("textbox", { name: "Source text *" }) as HTMLInputElement).value).toBe(
      "Manual content",
    );

    fireEvent.click(screen.getByRole("tab", { name: /^From URL/ }));
    expect((screen.getByRole("textbox", { name: "URL draft" }) as HTMLInputElement).value).toBe(
      "https://example.test/chapter-4",
    );

    fireEvent.click(screen.getByRole("tab", { name: /^EPUB file/ }));
    expect(screen.getByText("Selected: chapter-4.epub")).toBeTruthy();
    expect(screen.getByText("Upload progress: 42%")).toBeTruthy();
  });

  it("keeps every add mode mounted while inerting inactive panels", () => {
    renderAddChapter();

    const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="tabs-content"]'));
    const manualPanel = panels.find((panel) => panel.textContent?.includes("Source text *"));
    const urlPanel = panels.find((panel) => panel.textContent?.includes("URL draft"));
    const epubPanel = panels.find((panel) => panel.textContent?.includes("EPUB file"));

    expect(panels).toHaveLength(3);
    expect(manualPanel).toBeTruthy();
    expect(urlPanel).toBeTruthy();
    expect(epubPanel).toBeTruthy();
    expect(manualPanel?.getAttribute("inert")).toBeNull();
    expect(urlPanel?.getAttribute("inert")).not.toBeNull();
    expect(epubPanel?.getAttribute("inert")).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /^From URL/ }));

    expect(manualPanel?.getAttribute("inert")).not.toBeNull();
    expect(urlPanel?.getAttribute("inert")).toBeNull();
    expect(epubPanel?.getAttribute("inert")).not.toBeNull();
  });

  it("hands URL previews to the shared editor and can start a fresh draft", () => {
    renderAddChapter();
    fireEvent.click(screen.getByRole("tab", { name: /^From URL/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview URL" }));

    expect(screen.getByRole("tab", { name: /^Paste text/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("Fetched from URL.", { exact: true })).toBeTruthy();
    expect(screen.getByText(/Review the draft before adding it\./)).toBeTruthy();
    expect(screen.getByText("https://example.test/chapter-7")).toBeTruthy();
    expect(getChapterNumberInput().value).toBe("7");
    expect(
      (screen.getByRole("textbox", { name: "Chapter title *" }) as HTMLInputElement).value,
    ).toBe("Fetched chapter");

    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    expect(getChapterNumberInput().value).toBe("2");
    expect(
      (screen.getByRole("textbox", { name: "Chapter title *" }) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByRole("textbox", { name: "Source text *" }) as HTMLTextAreaElement).value,
    ).toBe("");
    expect(screen.queryByText(/Fetched from URL/)).toBeNull();
  });

  it("provides stable manual form names without autofill", () => {
    renderAddChapter();
    const numberInput = screen.getByRole("spinbutton", {
      name: "Chapter number *",
    }) as HTMLInputElement;
    const titleInput = screen.getByRole("textbox", {
      name: "Chapter title *",
    }) as HTMLInputElement;
    const contentInput = screen.getByRole("textbox", {
      name: "Source text *",
    }) as HTMLTextAreaElement;

    expect(numberInput.name).toBe("number");
    expect(numberInput.autocomplete).toBe("off");
    expect(titleInput.name).toBe("title");
    expect(titleInput.autocomplete).toBe("off");
    expect(contentInput.name).toBe("rawContent");
    expect(contentInput.autocomplete).toBe("off");
  });

  it("focuses the first invalid field and exposes inline validation semantics", async () => {
    renderAddChapter();
    const numberInput = screen.getByRole("spinbutton", { name: "Chapter number *" });
    fireEvent.change(numberInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add chapter" }));

    await waitFor(() => expect(document.activeElement).toBe(numberInput));
    expect(numberInput.getAttribute("aria-invalid")).toBe("true");
    expect(numberInput.getAttribute("aria-describedby")).toBe("chap-number-error");
    expect(screen.getByText("Chapter number must be positive")).toBeTruthy();
  });

  it("does not replace a manually edited or URL-preview chapter number after invalidation", () => {
    const { rerender, queryClient } = renderAddChapter([{ number: "1" }]);
    expect(getChapterNumberInput().value).toBe("2");
    rerender(
      <AddChapterHarness chapters={[{ number: "1" }, { number: "2" }]} queryClient={queryClient} />,
    );
    expect(getChapterNumberInput().value).toBe("3");

    fireEvent.change(getChapterNumberInput(), { target: { value: "42" } });
    rerender(
      <AddChapterHarness
        chapters={[{ number: "1" }, { number: "2" }, { number: "3" }]}
        queryClient={queryClient}
      />,
    );
    expect(getChapterNumberInput().value).toBe("42");

    fireEvent.click(screen.getByRole("tab", { name: /^From URL/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview URL" }));
    expect(getChapterNumberInput().value).toBe("7");

    rerender(
      <AddChapterHarness
        chapters={[{ number: "1" }, { number: "2" }, { number: "3" }, { number: "4" }]}
        queryClient={queryClient}
      />,
    );
    expect(getChapterNumberInput().value).toBe("7");
  });

  it("resynchronizes generated numbering after a dirty draft succeeds", async () => {
    const { rerender, queryClient } = renderAddChapter([{ number: "1" }, { number: "10" }]);
    expect(getChapterNumberInput().value).toBe("11");
    fireEvent.change(getChapterNumberInput(), { target: { value: "5" } });
    rerender(
      <AddChapterHarness
        chapters={[{ number: "1" }, { number: "10" }, { number: "20" }]}
        queryClient={queryClient}
      />,
    );
    expect(getChapterNumberInput().value).toBe("5");
    fireEvent.change(screen.getByRole("textbox", { name: "Chapter title *" }), {
      target: { value: "New chapter" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Source text *" }), {
      target: { value: "New chapter content" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add chapter" }));
    await waitFor(() => expect(createChapter).toHaveBeenCalledTimes(1));
    expect(createChapter).toHaveBeenCalledWith({
      data: {
        novelId: "novel-1",
        number: 5,
        title: "New chapter",
        rawContent: "New chapter content",
      },
    });
    await waitFor(() => expect(getChapterNumberInput().value).toBe("21"));

    rerender(
      <AddChapterHarness
        chapters={[
          { number: "1" },
          { number: "5" },
          { number: "10" },
          { number: "20" },
          { number: "30" },
        ]}
        queryClient={queryClient}
      />,
    );
    expect(getChapterNumberInput().value).toBe("31");
  });

  it("blocks both bulk starts during discovery and marks a hidden running import", () => {
    const scrapeController = {
      ...createImportController(),
      importActive: true,
      initialStatusLoading: true,
    };
    const epubController = {
      ...createImportController(),
      initialStatusLoading: true,
    };
    importMocks.useImportJob
      .mockReset()
      .mockImplementation((_novelId: string, _invalidateChapters: () => void, kind: string) =>
        kind === "scrape" ? scrapeController : epubController,
      );

    renderAddChapter();

    fireEvent.click(screen.getByRole("tab", { name: /From URL.*Running/ }));
    expect(
      screen.getByRole("button", { name: "Start URL range" }).getAttribute("disabled"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^EPUB file/ }));
    expect(
      screen.getByRole("button", { name: "Start upload" }).getAttribute("disabled"),
    ).not.toBeNull();
  });
});
