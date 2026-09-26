import { describe, expect, it } from "bun:test";
import { bookmarkCursorV1Schema } from "./reader-api";

describe("v1 bookmark cursor", () => {
  it("preserves database timestamp text at microsecond precision", () => {
    const cursor = { createdAt: "2024-02-29 23:59:59.123456", id: "bookmark-1" };
    expect(bookmarkCursorV1Schema.parse(cursor)).toEqual(cursor);
    expect(
      bookmarkCursorV1Schema.parse({ ...cursor, createdAt: "2026-01-01 12:00:00.1" }).createdAt,
    ).toBe("2026-01-01 12:00:00.1");
  });

  it("rejects invalid calendar dates and times without Date parsing", () => {
    for (const createdAt of [
      "0000-01-01 00:00:00",
      "2026-02-29 00:00:00",
      "2024-02-30 00:00:00",
      "2026-13-01 00:00:00",
      "2026-01-01 24:00:00",
      "2026-01-01 23:60:00",
      "2026-01-01 23:59:60",
    ]) {
      expect(bookmarkCursorV1Schema.safeParse({ createdAt, id: "bookmark-1" }).success).toBe(false);
    }
  });
});
