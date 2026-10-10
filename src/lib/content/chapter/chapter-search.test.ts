import { describe, expect, it } from "vitest";

import { filterChapters } from "./chapter-search";

const chapters = [
  { number: "1", title: "The Door", translatedTitle: "ประตู" },
  { number: "1.5", title: "Interlude", translatedTitle: "บทแทรก" },
  { number: "2", title: "The River", translatedTitle: null },
];

describe("filterChapters", () => {
  it("preserves server order and searches number, source, and translated titles", () => {
    expect(filterChapters(chapters, "บท").map((chapter) => chapter.number)).toEqual(["1.5"]);
    expect(filterChapters(chapters, "1").map((chapter) => chapter.number)).toEqual(["1", "1.5"]);
    expect(filterChapters(chapters, "river").map((chapter) => chapter.number)).toEqual(["2"]);
  });

  it("returns a new full array when the query is blank", () => {
    const result = filterChapters(chapters, "  ");

    expect(result).toEqual(chapters);
    expect(result).not.toBe(chapters);
  });
});
