// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReportCase } from "@/lib/reports/types";
import { ReportCaseDialog, type ReportCaseDecisionSubmission } from "./report-case-dialog";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));

const REPORT_CASE: ReportCase = {
  caseKey: "novel-1",
  target: {
    novelId: "novel-1",
    title: "The Hidden Map",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    coverUrl: null,
    coverSrcSet: null,
    ownerId: "user-2",
    ownerName: "Author",
    ownerEmail: "author@example.test",
  },
  openCount: 2,
  reasons: ["copyright", "spam_or_scam"],
  firstReportedAt: new Date("2026-01-02T00:00:00.000Z"),
  lastReportedAt: new Date("2026-01-03T00:00:00.000Z"),
  entries: [
    {
      id: "report-1",
      reporterUserId: "user-3",
      reporterEmail: "reader@example.test",
      reason: "copyright",
      details: "This is a reposted licensed translation.",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  ],
  truncated: false,
};

async function renderDialog({
  busy = false,
  reportCase = REPORT_CASE,
}: { busy?: boolean; reportCase?: ReportCase | null } = {}) {
  const onResolve = vi.fn<(submission: ReportCaseDecisionSubmission) => void>();
  render(
    <ReportCaseDialog
      open
      reportCase={reportCase}
      busy={busy}
      onOpenChange={() => undefined}
      onResolve={onResolve}
    />,
  );

  const dialog = within(await screen.findByRole("dialog"));
  const note = dialog.getByLabelText("Decision note") as HTMLTextAreaElement;
  const dismiss = dialog.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement;
  const uphold = dialog.getByRole("button", { name: "Uphold" }) as HTMLButtonElement;

  return { dialog, note, dismiss, uphold, onResolve };
}

afterEach(cleanup);

describe("ReportCaseDialog", () => {
  it("shows the case file with each reporter's claim", async () => {
    const { dialog } = await renderDialog();

    expect(dialog.getByText(/2 open reports on/)).toBeTruthy();
    expect(dialog.getByText("The Hidden Map")).toBeTruthy();
    expect(dialog.getByText("This is a reposted licensed translation.")).toBeTruthy();
    expect(dialog.getByText("Reported by reader@example.test")).toBeTruthy();
  });

  it("records the decision with the note trimmed", async () => {
    const { note, uphold, onResolve } = await renderDialog();

    fireEvent.change(note, { target: { value: "  Reposted translation.  " } });
    fireEvent.click(uphold);

    expect(onResolve).toHaveBeenCalledWith({ decision: "upheld", note: "Reposted translation." });
  });

  it("keeps Uphold unavailable until the note says something", async () => {
    const { note, uphold } = await renderDialog();

    expect(uphold.disabled).toBe(true);

    fireEvent.change(note, { target: { value: "   " } });
    expect(uphold.disabled).toBe(true);

    fireEvent.change(note, { target: { value: "Stolen." } });
    expect(uphold.disabled).toBe(false);
  });

  it("dismisses without a note", async () => {
    const { dismiss, onResolve } = await renderDialog();

    fireEvent.click(dismiss);

    expect(onResolve).toHaveBeenCalledWith({ decision: "dismissed", note: undefined });
  });

  it("disables the decision controls while a decision is in flight", async () => {
    const { dismiss, uphold } = await renderDialog({ busy: true });

    expect(dismiss.disabled).toBe(true);
    expect(uphold.disabled).toBe(true);
  });

  it("keeps a case without a novel readable", async () => {
    const { dialog } = await renderDialog({
      reportCase: {
        ...REPORT_CASE,
        caseKey: "report-1",
        target: { ...REPORT_CASE.target, novelId: null, title: "A deleted novel" },
      },
    });

    expect(dialog.getByText("A deleted novel")).toBeTruthy();
    expect(dialog.queryByText("Open the novel")).toBeNull();
  });
});
