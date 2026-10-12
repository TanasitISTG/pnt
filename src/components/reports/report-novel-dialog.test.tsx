// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportNovelDialog } from "./report-novel-dialog";
import type { ReportNovelDialogProps } from "./report-novel-dialog";

afterEach(cleanup);

function renderDialog(overrides: Partial<ReportNovelDialogProps> = {}) {
  const onConfirm = vi.fn();
  render(
    <ReportNovelDialog
      open
      novelTitle="The Hidden Map"
      onOpenChange={() => undefined}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm };
}

/**
 * Matched loosely because the in-flight Spinner carries `aria-label="Loading"`, which a
 * screen reader (and this query) reads as part of the button's name.
 */
function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Send report/ }) as HTMLButtonElement;
}

/** Base UI selects open on click and commit on pointerdown plus click, as its own tests do. */
function chooseReason(label: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: "Reason" }));
  fireEvent.pointerDown(screen.getByRole("option", { name: label }), { pointerType: "mouse" });
  fireEvent.click(screen.getByRole("option", { name: label }));
}

function typeDetails(value: string): void {
  fireEvent.change(screen.getByLabelText("What is wrong?"), { target: { value } });
}

describe("ReportNovelDialog", () => {
  it("will not send a report without a reason", () => {
    const { onConfirm } = renderDialog();

    expect(submitButton().disabled).toBe(true);

    submitButton().click();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("requires details when the reason is Something else", () => {
    const { onConfirm } = renderDialog();

    chooseReason("Something else");

    expect(screen.getByRole("alert").textContent).toContain("Tell us what is wrong");
    expect(submitButton().disabled).toBe(true);

    typeDetails("   ");
    expect(submitButton().disabled).toBe(true);

    typeDetails("  Stolen from chapter 12  ");
    expect(submitButton().disabled).toBe(false);

    fireEvent.click(submitButton());

    expect(onConfirm).toHaveBeenCalledWith({ reason: "other", details: "Stolen from chapter 12" });
  });

  it("sends a reason that needs no explanation without details", () => {
    const { onConfirm } = renderDialog();

    chooseReason("Sexual or explicit cover");
    typeDetails("   ");
    fireEvent.click(submitButton());

    expect(onConfirm).toHaveBeenCalledWith({ reason: "sexual_cover", details: undefined });
  });

  it("holds the controls while a report is in flight", () => {
    const { onConfirm } = renderDialog({ busy: true });

    chooseReason("Spam, scam, or misleading");

    expect(submitButton().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    submitButton().click();

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
