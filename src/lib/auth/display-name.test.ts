import { describe, expect, it } from "vitest";

import { FALLBACK_NAME_MAX_LENGTH, fallbackDisplayName } from "./display-name";

describe("fallbackDisplayName", () => {
  it("keeps the name a provider supplied", () => {
    expect(fallbackDisplayName({ name: "Ada Lovelace", email: "ada@example.test" })).toBe(
      "Ada Lovelace",
    );
  });

  it("trims it", () => {
    expect(fallbackDisplayName({ name: "  Ada  ", email: "ada@example.test" })).toBe("Ada");
  });

  it("falls back to the address when the provider sent an empty name", () => {
    // Discord returns an empty string for an account with no global name.
    expect(fallbackDisplayName({ name: "", email: "quiet.reader@example.test" })).toBe(
      "quiet.reader",
    );
    expect(fallbackDisplayName({ name: "   ", email: "quiet.reader@example.test" })).toBe(
      "quiet.reader",
    );
    expect(fallbackDisplayName({ email: "quiet.reader@example.test" })).toBe("quiet.reader");
  });

  it("bounds the fallback to a name the profile form can save", () => {
    const long = `${"a".repeat(80)}@example.test`;

    expect(fallbackDisplayName({ name: null, email: long })).toHaveLength(FALLBACK_NAME_MAX_LENGTH);
  });

  it("never returns an empty name", () => {
    expect(fallbackDisplayName({ name: null, email: null })).toBe("Reader");
    expect(fallbackDisplayName({ name: "", email: "" })).toBe("Reader");
    expect(fallbackDisplayName({ name: "", email: "@example.test" })).toBe("Reader");
  });

  it("ignores values of the wrong type", () => {
    expect(fallbackDisplayName({ name: 42, email: "reader@example.test" })).toBe("reader");
    expect(fallbackDisplayName({ name: "Ada", email: 42 })).toBe("Ada");
  });
});
