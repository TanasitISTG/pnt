import { describe, expect, it } from "vitest";

import { encodeMessage } from "@/lib/i18n/message-code";
import { assertImageMagicBytes } from "./magic-bytes";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const INVALID = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

describe("assertImageMagicBytes", () => {
  it.each([
    [PNG, "image/png"],
    [JPEG, "image/jpeg"],
    [WEBP, "image/webp"],
  ])("accepts %s bytes whose header matches the declared type", (bytes, mime) => {
    expect(() => assertImageMagicBytes(bytes, mime)).not.toThrow();
  });

  it.each([
    ["image/png", INVALID],
    ["image/jpeg", INVALID],
    ["image/webp", INVALID],
  ])("rejects bytes that disagree with a declared %s", (mime, bytes) => {
    expect(() => assertImageMagicBytes(bytes, mime)).toThrow(
      encodeMessage("errors.imageTypeMismatch"),
    );
  });

  it("rejects an unsupported declared type, naming the type as data", () => {
    expect(() => assertImageMagicBytes(PNG, "image/gif")).toThrow(
      encodeMessage("errors.imageUnsupportedType", { mime: "image/gif" }),
    );
  });

  it("rejects a missing declared type", () => {
    expect(() => assertImageMagicBytes(INVALID, "")).toThrow(
      encodeMessage("errors.imageMimeRequired"),
    );
  });

  it("rejects truncated buffers instead of reading past the end", () => {
    expect(() => assertImageMagicBytes(new Uint8Array([0x89, 0x50]), "image/png")).toThrow(
      encodeMessage("errors.imageTypeMismatch"),
    );
    expect(() => assertImageMagicBytes(new Uint8Array(11), "image/webp")).toThrow(
      encodeMessage("errors.imageTypeMismatch"),
    );
  });

  it("says the same thing for every upload path, so the copy can be translated", () => {
    // The message used to be built from an English noun the caller supplied ("Cover",
    // "Profile"), which made it untranslatable. It is now one code per rule, and the path that
    // called it is what names the image.
    const coverMessage = (() => {
      try {
        assertImageMagicBytes(INVALID, "image/png");
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    })();
    const profileMessage = (() => {
      try {
        assertImageMagicBytes(WEBP, "image/png");
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    })();
    expect(coverMessage).toBe(profileMessage);
  });
});
