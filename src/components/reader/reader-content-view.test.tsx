// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderContentView } from "./reader-content-view";

afterEach(cleanup);

describe("ReaderContentView", () => {
  it("keeps failed translation recovery and manual editing in the content area", () => {
    const onTranslateRequest = vi.fn();
    const onEditRequest = vi.fn();

    render(
      <ReaderContentView
        hasTranslation={false}
        viewMode="translated"
        aligned={[]}
        rawParagraphs={["Raw chapter text"]}
        translatedParagraphs={[]}
        fontSizePx={18}
        sourceLang="en"
        isAdmin
        translationStatus="error"
        onTranslateRequest={onTranslateRequest}
        onEditRequest={onEditRequest}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry translation" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit chapter" }));

    expect(onTranslateRequest).toHaveBeenCalledTimes(1);
    expect(onEditRequest).toHaveBeenCalledTimes(1);
  });

  it("shows no admin recovery controls to guests", () => {
    render(
      <ReaderContentView
        hasTranslation={false}
        viewMode="raw"
        aligned={[]}
        rawParagraphs={["Raw chapter text"]}
        translatedParagraphs={[]}
        fontSizePx={18}
        sourceLang="en"
        translationStatus="error"
        onTranslateRequest={vi.fn()}
        onEditRequest={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Retry translation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit chapter" })).toBeNull();
  });

  it("offers admins a visible edit action when the chapter has no readable text", () => {
    const onEditRequest = vi.fn();

    render(
      <ReaderContentView
        hasTranslation={false}
        viewMode="translated"
        aligned={[]}
        rawParagraphs={[]}
        translatedParagraphs={[]}
        fontSizePx={18}
        isAdmin
        onEditRequest={onEditRequest}
      />,
    );

    expect(screen.getByText("This chapter has no readable text.")).toBeTruthy();
    const editButton = screen.getByRole("button", { name: "Edit chapter" });
    expect(editButton.className).toContain("min-h-11");
    fireEvent.click(editButton);
    expect(onEditRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps the empty-source state neutral and action-free for guests", () => {
    render(
      <ReaderContentView
        hasTranslation={false}
        viewMode="translated"
        aligned={[]}
        rawParagraphs={[]}
        translatedParagraphs={[]}
        fontSizePx={18}
        onEditRequest={vi.fn()}
      />,
    );

    expect(screen.getByText("This chapter has no readable text.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit chapter" })).toBeNull();
  });
});
