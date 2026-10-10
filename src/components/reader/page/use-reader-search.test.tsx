// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useReaderSearch } from "./use-reader-search";

afterEach(cleanup);

describe("useReaderSearch", () => {
  it("starts at the first match after leaving and returning to a search scope", async () => {
    const { result, rerender } = renderHook(
      ({ chapterKey, viewMode }: { chapterKey: string; viewMode: "raw" | "translated" }) =>
        useReaderSearch({
          chapterKey,
          viewMode,
          enabled: true,
          hasTranslation: false,
          rawParagraphs: ["echo echo echo"],
          translatedParagraphs: [],
          aligned: [],
        }),
      { initialProps: { chapterKey: "first", viewMode: "raw" as "raw" | "translated" } },
    );

    act(() => result.current.setQuery("echo"));
    await waitFor(() => expect(result.current.matchCount).toBe(3));
    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);

    rerender({ chapterKey: "second", viewMode: "raw" });
    expect(result.current.activeIndex).toBe(0);
    rerender({ chapterKey: "first", viewMode: "raw" });
    expect(result.current.activeIndex).toBe(0);

    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);
    rerender({ chapterKey: "first", viewMode: "translated" });
    expect(result.current.activeIndex).toBe(0);
    rerender({ chapterKey: "first", viewMode: "raw" });
    expect(result.current.activeIndex).toBe(0);

    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.setQuery("other"));
    await waitFor(() => expect(result.current.matchCount).toBe(0));
    act(() => result.current.setQuery("echo"));
    await waitFor(() => expect(result.current.matchCount).toBe(3));
    expect(result.current.activeIndex).toBe(0);
  });
});
