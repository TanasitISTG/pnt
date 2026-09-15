// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImportJobState } from "@/components/chapters/use-import-job";
import { ChapterImportStatus } from "./chapter-import-status";

const runningJob: ImportJobState = {
  id: "job-1",
  kind: "scrape",
  status: "running",
  sourceFileName: null,
  fromNumber: 1,
  toNumber: 5,
  nextNumber: 4,
  added: 2,
  skipped: 1,
  failed: 0,
  error: null,
};

afterEach(cleanup);

describe("ChapterImportStatus", () => {
  it("limits live announcements to a concise import summary", () => {
    render(
      <ChapterImportStatus
        label="URL range import"
        job={runningJob}
        active
        statusError={new Error("Polling failed")}
        onRetryStatus={vi.fn()}
      />,
    );

    const status = screen.getByRole("status");
    const retryButton = screen.getByRole("button", { name: "Retry status" });
    const alert = screen.getByRole("alert");

    expect(status.textContent).toBe("URL range import: running. 3 of 5 chapters.");
    expect(status.contains(retryButton)).toBe(false);
    expect(status.contains(alert)).toBe(false);
    expect(alert.textContent).toContain("Polling failed");
  });
});
