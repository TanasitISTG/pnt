// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEpubUpload: vi.fn(),
  uploadEpubChunk: vi.fn(),
  completeEpubUpload: vi.fn(),
  abortEpubUpload: vi.fn(),
  useImportJob: vi.fn(),
  attachJob: vi.fn(),
  cancelImport: vi.fn(),
  retryImportStatus: vi.fn(),
}));

vi.mock("@/lib/epub/functions", () => ({
  createEpubUpload: mocks.createEpubUpload,
  uploadEpubChunk: mocks.uploadEpubChunk,
  completeEpubUpload: mocks.completeEpubUpload,
  abortEpubUpload: mocks.abortEpubUpload,
}));
vi.mock("./use-import-job", () => ({
  useImportJob: mocks.useImportJob,
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { EpubImportSection } from "./epub-import-section";
import type { ImportJobController } from "./use-import-job";

function defaultController(): ImportJobController {
  return {
    importJob: null,
    importActive: false,
    initialStatusLoading: false,
    startPending: false,
    startImport: vi.fn(),
    cancelImport: mocks.cancelImport,
    attachJob: mocks.attachJob,
    importStatusError: null,
    retryImportStatus: mocks.retryImportStatus,
    canRetryImport: false,
    retryImport: vi.fn(),
  };
}

function renderEpub(
  otherImportActive = false,
  importController = defaultController(),
  bulkStartDisabled = importController.initialStatusLoading,
) {
  const onUploadActivityChange = vi.fn();
  const view = render(
    <EpubImportSection
      novelId="novel-1"
      importController={importController}
      bulkStartDisabled={bulkStartDisabled}
      onUploadActivityChange={onUploadActivityChange}
      otherImportActive={otherImportActive}
    />,
  );
  return { ...view, onUploadActivityChange, importController };
}

describe("EpubImportSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("selects a dropped EPUB, preserves it through invalid replacement, and removes it", () => {
    renderEpub();
    const dropTarget = screen.getByRole("button", { name: /Drop an EPUB here or choose a file/ });
    const input = screen.getByLabelText("EPUB file") as HTMLInputElement;
    const validFile = new File(["epub"], "chapter.epub", { type: "application/epub+zip" });
    expect(input.name).toBe("epubFile");
    expect(input.autocomplete).toBe("off");

    fireEvent.drop(dropTarget, { dataTransfer: { files: [validFile] } });
    expect(screen.getByText("chapter.epub")).toBeTruthy();
    expect(screen.getByText("4 B")).toBeTruthy();

    fireEvent.change(input, {
      target: { files: [new File(["text"], "notes.txt", { type: "text/plain" })] },
    });
    expect(screen.getByText("chapter.epub")).toBeTruthy();
    expect(screen.getByText("Please select a valid .epub file")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(screen.queryByText("chapter.epub")).toBeNull();
    expect(screen.getByRole("button", { name: /Drop an EPUB here or choose a file/ })).toBeTruthy();
  });

  it("reports upload activity synchronously at start and settlement", async () => {
    mocks.createEpubUpload.mockResolvedValue({ uploadId: "upload-1" });
    mocks.uploadEpubChunk.mockResolvedValue({ receivedBytes: 4 });
    mocks.completeEpubUpload.mockResolvedValue({ jobId: "epub-job-1" });
    const view = renderEpub();
    const file = new File(["epub"], "chapter.epub", { type: "application/epub+zip" });

    fireEvent.drop(screen.getByRole("button", { name: /Drop an EPUB here or choose a file/ }), {
      dataTransfer: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload and import" }));

    expect(view.onUploadActivityChange).toHaveBeenNthCalledWith(1, true);
    await vi.waitFor(() => expect(mocks.completeEpubUpload).toHaveBeenCalledTimes(1));
    expect(view.onUploadActivityChange).toHaveBeenLastCalledWith(false);
  });

  it("blocks upload controls while another bulk import is active", () => {
    const view = renderEpub();
    const validFile = new File(["epub"], "chapter.epub", { type: "application/epub+zip" });
    fireEvent.drop(screen.getByRole("button", { name: /Drop an EPUB here or choose a file/ }), {
      dataTransfer: { files: [validFile] },
    });

    view.rerender(
      <EpubImportSection
        novelId="novel-1"
        importController={view.importController}
        bulkStartDisabled={false}
        onUploadActivityChange={view.onUploadActivityChange}
        otherImportActive
      />,
    );

    expect(
      screen.getByRole("button", { name: "Replace file" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Upload and import" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(
      screen.getByText("Finish or cancel the URL range import before starting an EPUB import."),
    ).toBeTruthy();
  });

  it("renders EPUB progress counters and exposes cancel while importing", () => {
    const importController = {
      ...defaultController(),
      importJob: {
        id: "epub-job-1",
        kind: "epub" as const,
        status: "running" as const,
        sourceFileName: "novel.epub",
        fromNumber: 1,
        toNumber: 5,
        nextNumber: 3,
        added: 1,
        skipped: 1,
        failed: 0,
        error: null,
      },
      importActive: true,
    };
    renderEpub(false, importController);

    expect(screen.getByText("2 of 5 chapters")).toBeTruthy();
    expect(screen.getByText("novel.epub")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel import" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(mocks.cancelImport).toHaveBeenCalledTimes(1);
  });

  it("preserves refresh-recovered cancelled status and asks for the file again", () => {
    const importController = {
      ...defaultController(),
      importJob: {
        id: "epub-job-2",
        kind: "epub" as const,
        status: "cancelled" as const,
        sourceFileName: "novel.epub",
        fromNumber: 1,
        toNumber: 5,
        nextNumber: 3,
        added: 1,
        skipped: 1,
        failed: 0,
        error: null,
      },
    };
    renderEpub(false, importController);

    expect(
      screen.getByText("Choose the EPUB file again before retrying this import."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry EPUB import" }).getAttribute("disabled"),
    ).not.toBeNull();
  });
});
