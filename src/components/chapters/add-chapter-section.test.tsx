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

interface MockChapterFetched {
  number: string;
  title: string;
  content: string;
}

interface MockScrapeImportSectionProps {
  onChapterFetched: (chapter: MockChapterFetched) => void;
}

function MockScrapeImportSection({ onChapterFetched }: MockScrapeImportSectionProps) {
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
          })
        }
      >
        Preview URL
      </button>
    </div>
  );
}

function MockEpubImportSection() {
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
      <button type="button" onClick={() => setUploadProgress(42)}>
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
    vi.mocked(createChapter).mockResolvedValue({ id: "chapter-new" });
  });

  it("keeps manual, URL, and EPUB panel state mounted across mode switches", () => {
    renderAddChapter();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Number *" }), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
      target: { value: "Manual draft" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Raw Content *" }), {
      target: { value: "Manual content" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "URL" }));
    fireEvent.change(screen.getByRole("textbox", { name: "URL draft" }), {
      target: { value: "https://example.test/chapter-4" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "EPUB" }));
    const file = new File(["epub"], "chapter-4.epub", { type: "application/epub+zip" });
    fireEvent.change(screen.getByLabelText("EPUB file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Start upload" }));

    fireEvent.click(screen.getByRole("tab", { name: "Manual" }));
    expect((screen.getByRole("spinbutton", { name: "Number *" }) as HTMLInputElement).value).toBe(
      "4",
    );
    expect((screen.getByRole("textbox", { name: "Title *" }) as HTMLInputElement).value).toBe(
      "Manual draft",
    );
    expect((screen.getByRole("textbox", { name: "Raw Content *" }) as HTMLInputElement).value).toBe(
      "Manual content",
    );

    fireEvent.click(screen.getByRole("tab", { name: "URL" }));
    expect((screen.getByRole("textbox", { name: "URL draft" }) as HTMLInputElement).value).toBe(
      "https://example.test/chapter-4",
    );

    fireEvent.click(screen.getByRole("tab", { name: "EPUB" }));
    expect(screen.getByText("Selected: chapter-4.epub")).toBeTruthy();
    expect(screen.getByText("Upload progress: 42%")).toBeTruthy();
  });

  it("keeps every add mode mounted while inerting inactive panels", () => {
    renderAddChapter();

    const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="tabs-content"]'));
    const manualPanel = panels.find((panel) => panel.textContent?.includes("Raw Content *"));
    const urlPanel = panels.find((panel) => panel.textContent?.includes("URL draft"));
    const epubPanel = panels.find((panel) => panel.textContent?.includes("EPUB file"));

    expect(panels).toHaveLength(3);
    expect(manualPanel).toBeTruthy();
    expect(urlPanel).toBeTruthy();
    expect(epubPanel).toBeTruthy();
    expect(manualPanel?.getAttribute("inert")).toBeNull();
    expect(urlPanel?.getAttribute("inert")).not.toBeNull();
    expect(epubPanel?.getAttribute("inert")).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "URL" }));

    expect(manualPanel?.getAttribute("inert")).not.toBeNull();
    expect(urlPanel?.getAttribute("inert")).toBeNull();
    expect(epubPanel?.getAttribute("inert")).not.toBeNull();
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

    fireEvent.click(screen.getByRole("tab", { name: "URL" }));
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
    fireEvent.change(screen.getByRole("textbox", { name: "Title *" }), {
      target: { value: "New chapter" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Raw Content *" }), {
      target: { value: "New chapter content" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Chapter" }));
    await waitFor(() => expect(createChapter).toHaveBeenCalledTimes(1));
    expect(createChapter).toHaveBeenCalledWith({
      data: expect.objectContaining({ number: 5 }),
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
});
