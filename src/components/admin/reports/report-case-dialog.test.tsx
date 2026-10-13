// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReportCase } from "@/lib/reports/types";
import {
  ReportCaseDialog,
  type ReportCaseDecisionSubmission,
  type ReportContentRemovalSubmission,
} from "./report-case-dialog";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));

const REPORT_CASE: ReportCase = {
  caseKey: "novel-1",
  target: {
    type: "novel",
    novelId: "novel-1",
    title: "The Hidden Map",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    coverUrl: null,
    coverSrcSet: null,
    ownerId: "user-2",
    ownerName: "Author",
    ownerEmail: "author@example.test",
    excerpt: null,
    authorId: null,
    authorName: null,
    authorEmail: null,
    rating: null,
    chapterId: null,
    chapterNumber: null,
    chapterTitle: null,
    removedAt: null,
    deleted: false,
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

const COMMENT_CASE: ReportCase = {
  ...REPORT_CASE,
  caseKey: "comment-1",
  target: {
    ...REPORT_CASE.target,
    type: "comment",
    excerpt: "Read chapter 12 before you believe any of this.",
    authorId: "user-9",
    authorEmail: "commenter@example.test",
    ownerEmail: null,
    ownerId: null,
    chapterId: "chapter-1",
    chapterNumber: 12,
    chapterTitle: "The Map",
  },
};

async function renderDialog({
  busy = false,
  removing = false,
  reportCase = REPORT_CASE,
}: {
  busy?: boolean;
  removing?: boolean;
  reportCase?: ReportCase | null;
} = {}) {
  const onResolve = vi.fn<(submission: ReportCaseDecisionSubmission) => void>();
  const onRemove = vi.fn<(submission: ReportContentRemovalSubmission) => void>();
  render(
    <ReportCaseDialog
      open
      reportCase={reportCase}
      busy={busy}
      removing={removing}
      onOpenChange={() => undefined}
      onResolve={onResolve}
      onRemove={onRemove}
    />,
  );

  const dialog = within(await screen.findByRole("dialog"));
  const note = dialog.getByLabelText("Decision note") as HTMLTextAreaElement;
  const dismiss = dialog.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement;
  const uphold = dialog.getByRole("button", { name: "Uphold" }) as HTMLButtonElement;

  return { dialog, note, dismiss, uphold, onResolve, onRemove };
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

  it("has no removal action for a novel", async () => {
    const { dialog } = await renderDialog();

    expect(dialog.queryByRole("button", { name: /Remove content/ })).toBeNull();
  });

  it("removes reported content only after a reason is written", async () => {
    const { dialog, onRemove } = await renderDialog({ reportCase: COMMENT_CASE });

    expect(dialog.getByText("Read chapter 12 before you believe any of this.")).toBeTruthy();

    fireEvent.click(dialog.getByRole("button", { name: "Remove content…" }));

    const confirm = dialog.getByRole("button", { name: /Remove content/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(dialog.getByLabelText("Reason for removal"), {
      target: { value: "  Spoilers outside the spoiler window.  " },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    expect(onRemove).toHaveBeenCalledWith({ reason: "Spoilers outside the spoiler window." });
  });

  it("says when the reported content is already removed", async () => {
    const { dialog } = await renderDialog({
      reportCase: {
        ...COMMENT_CASE,
        target: { ...COMMENT_CASE.target, removedAt: new Date("2026-01-04T00:00:00.000Z") },
      },
    });

    expect(dialog.getByText("Removed")).toBeTruthy();
    expect(dialog.getByText(/already been removed/)).toBeTruthy();
    expect(dialog.queryByRole("button", { name: /Remove content/ })).toBeNull();
  });
});
