// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { downloadUrl } from "@/lib/download";
import { NovelExportMenu } from "./novel-export-menu";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/download", () => ({
  downloadUrl: vi.fn(),
}));

function openMenu() {
  render(<NovelExportMenu novelId="novel-1" />);
  fireEvent.click(screen.getByRole("button", { name: /export/i }));
}

function chooseFormat(label: string) {
  fireEvent.click(screen.getByText(label));
}

describe("NovelExportMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("downloads the format the owner picked from the authenticated route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    openMenu();

    chooseFormat("Export as EPUB");

    await waitFor(() => {
      expect(downloadUrl).toHaveBeenCalledWith("/api/exports/novel-1/epub");
    });
    // The preflight is a HEAD: it answers with the status alone and opens no body cursor.
    expect(fetchMock).toHaveBeenCalledWith("/api/exports/novel-1/epub", { method: "HEAD" });
  });

  it("says the novel has nothing to export rather than starting an empty download", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    openMenu();

    chooseFormat("Export as TXT");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("No translated chapters to export yet");
    });
    expect(downloadUrl).not.toHaveBeenCalled();
  });

  it("reports a failed preflight as a failed export", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    openMenu();

    chooseFormat("Export as TXT");

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Export failed");
    });
    expect(downloadUrl).not.toHaveBeenCalled();
  });
});
