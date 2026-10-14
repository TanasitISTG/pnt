import { describe, expect, it } from "vitest";

import { encodeMessage, isMessageCode, parseMessage } from "./message-code";

/**
 * The codec that lets the server say *what* happened and the client say it *in its own
 * language* (i18n.md §3).
 *
 * The property that matters most is the negative one: anything that is not a code has to come
 * back untouched, because Better Auth's own messages, Zod's defaults and every string written
 * before this codec existed travel the same path.
 */
describe("message codes", () => {
  it("is the bare key when there is nothing to interpolate", () => {
    expect(encodeMessage("errors.chapterNotFound")).toBe("errors.chapterNotFound");
  });

  it("carries values as JSON after the key", () => {
    const code = encodeMessage("validation.tooLong", { max: 5000 });
    expect(code).toBe('validation.tooLong|{"max":5000}');
    expect(parseMessage(code)).toEqual({ key: "validation.tooLong", values: { max: 5000 } });
  });

  it("round-trips a key with no values", () => {
    expect(parseMessage(encodeMessage("comments.emptyTitle"))).toEqual({
      key: "comments.emptyTitle",
    });
  });

  it("passes an ordinary sentence through as no code at all", () => {
    for (const sentence of [
      "Invalid email or password",
      "Invalid credentials.",
      "email",
      "",
      "errors",
      "errors.",
    ]) {
      expect(parseMessage(sentence)).toBeNull();
      expect(isMessageCode(sentence)).toBe(false);
    }
  });

  it("keeps the key when the values are not JSON", () => {
    expect(parseMessage("errors.chapterNotFound|{oops")).toEqual({
      key: "errors.chapterNotFound",
    });
  });

  it("does not mistake an English sentence containing a dot for a key", () => {
    // The pattern is a namespace plus camelCase segments, so sentence punctuation cannot pass.
    expect(isMessageCode("Could not save. Try again")).toBe(false);
    expect(isMessageCode("gpt-4.1 is unavailable")).toBe(false);
  });
});
