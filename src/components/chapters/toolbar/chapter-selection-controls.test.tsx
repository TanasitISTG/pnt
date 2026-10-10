// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChapterSelectionControls,
  type ChapterSelectionControlsProps,
} from "./chapter-selection-controls";

afterEach(cleanup);

function renderControls(onSelectRange = vi.fn()) {
  const props: ChapterSelectionControlsProps = {
    selectedCount: 0,
    hiddenSelectedCount: 0,
    selectableCount: 10,
    selectedMissingCount: 0,
    selectedTranslatedCount: 0,
    selectedActiveCount: 0,
    batchStarting: false,
    batchStopping: false,
    onBatchTranslate: vi.fn(),
    onRequestBatchRetranslate: vi.fn(),
    onRequestBatchStop: vi.fn(),
    onClearSelection: vi.fn(),
    onSelectRange,
  };
  render(<ChapterSelectionControls {...props} />);
  return onSelectRange;
}

describe("ChapterSelectionControls", () => {
  it("renders the range invariant inline and rejects reversed bounds", async () => {
    const onSelectRange = renderControls();
    fireEvent.change(screen.getByLabelText("From chapter"), { target: { value: "5" } });
    const toInput = screen.getByLabelText("To chapter");
    fireEvent.change(toInput, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Select range" }));

    expect(await screen.findByText("Enter a valid range (from ≥ 1, from ≤ to)")).toBeTruthy();
    expect(toInput.getAttribute("aria-invalid")).toBe("true");
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it("marks the offending bound instead of always blaming the end of the range", async () => {
    const onSelectRange = renderControls();
    const fromInput = screen.getByLabelText("From chapter");
    fireEvent.change(fromInput, { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("To chapter"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Select range" }));

    expect(await screen.findByText("Enter a valid range (from ≥ 1, from ≤ to)")).toBeTruthy();
    expect(fromInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("To chapter").getAttribute("aria-invalid")).toBe("false");
    expect(onSelectRange).not.toHaveBeenCalled();
  });

  it("parses valid string inputs before dispatching selection", async () => {
    const onSelectRange = renderControls();
    fireEvent.change(screen.getByLabelText("From chapter"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("To chapter"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Select range" }));

    await vi.waitFor(() => expect(onSelectRange).toHaveBeenCalledWith(2, 7));
  });
});
