// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReaderContentView } from "./reader-content-view";

afterEach(cleanup);

describe("ReaderContentView", () => {
  it.each(["idle", "running", "error"] as const)(
    "keeps untranslated chapter text free of actions when translation is %s",
    (translationStatus) => {
      render(
        <ReaderContentView
          hasTranslation={false}
          viewMode="translated"
          aligned={[]}
          rawParagraphs={["Raw chapter text"]}
          translatedParagraphs={[]}
          fontSizePx={18}
          lineHeight={1.75}
          measureRem={42}
          sourceLang="en"
          isAdmin
          translationStatus={translationStatus}
        />,
      );

      expect(screen.getByText("Not translated yet — showing raw text.")).toBeTruthy();
      expect(screen.getByText("Raw chapter text")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it("preserves failed translation status without adding actions to the reading area", () => {
    render(
      <ReaderContentView
        hasTranslation
        viewMode="translated"
        aligned={[]}
        rawParagraphs={["Raw chapter text"]}
        translatedParagraphs={["Translated chapter text"]}
        fontSizePx={18}
        lineHeight={1.75}
        measureRem={42}
        isAdmin
        translationStatus="error"
      />,
    );

    expect(screen.getByText("The last translation attempt did not finish.")).toBeTruthy();
    expect(
      screen.getByText("Use chapter actions to retry translation or edit the chapter."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows an empty chapter without a duplicate edit action", () => {
    render(
      <ReaderContentView
        hasTranslation={false}
        viewMode="translated"
        aligned={[]}
        rawParagraphs={[]}
        translatedParagraphs={[]}
        fontSizePx={18}
        lineHeight={1.75}
        measureRem={42}
        isAdmin
      />,
    );

    expect(screen.getByText("This chapter has no readable text.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
