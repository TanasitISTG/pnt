import { describe, expect, it } from "vitest";

import { decodeStrictBase64 } from "./functions";
import { SafeServerError } from "@/lib/server-fn-error";

describe("decodeStrictBase64", () => {
  it("decodes canonical base64", () => {
    expect(decodeStrictBase64("aGVsbG8=").toString("utf8")).toBe("hello");
  });

  it("rejects malformed, unpadded, and whitespace-containing values", () => {
    for (const value of ["aGVsbG8", "aGVsbG8!", "aGVs bG8="]) {
      expect(() => decodeStrictBase64(value)).toThrow(SafeServerError);
    }
  });

  it("rejects values larger than one upload chunk", () => {
    const oversized = "A".repeat(Math.ceil((1024 * 1024) / 3) * 4 + 4);
    expect(() => decodeStrictBase64(oversized)).toThrow("valid base64");
  });
});
