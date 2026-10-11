import { describe, expect, it } from "vitest";

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
    expect(() => assertImageMagicBytes(bytes, mime, "Profile")).not.toThrow();
  });

  it("keeps the cover-labelled messages callers already assert on", () => {
    expect(() => assertImageMagicBytes(INVALID, "image/png", "Cover")).toThrow(
      "Cover image magic bytes do not match declared PNG MIME type",
    );
    expect(() => assertImageMagicBytes(INVALID, "image/jpeg", "Cover")).toThrow(
      "Cover image magic bytes do not match declared JPEG MIME type",
    );
    expect(() => assertImageMagicBytes(INVALID, "image/webp", "Cover")).toThrow(
      "Cover image magic bytes do not match declared WebP MIME type",
    );
    expect(() => assertImageMagicBytes(INVALID, "image/gif", "Cover")).toThrow(
      "Unsupported cover MIME type: image/gif",
    );
    expect(() => assertImageMagicBytes(INVALID, "", "Cover")).toThrow(
      "Cover MIME type is required to validate cover image",
    );
  });

  it("names the profile upload in its own messages", () => {
    expect(() => assertImageMagicBytes(INVALID, "image/png", "Profile")).toThrow(
      "Profile image magic bytes do not match declared PNG MIME type",
    );
    expect(() => assertImageMagicBytes(INVALID, "", "Profile")).toThrow(
      "Profile MIME type is required to validate profile image",
    );
  });

  it("rejects a buffer whose bytes disagree with the declared type", () => {
    // A WebP upload claiming to be a PNG: the declared type is a claim, not evidence.
    expect(() => assertImageMagicBytes(WEBP, "image/png", "Profile")).toThrow(
      "Profile image magic bytes do not match declared PNG MIME type",
    );
  });

  it("rejects truncated buffers instead of reading past the end", () => {
    expect(() => assertImageMagicBytes(new Uint8Array([0x89, 0x50]), "image/png", "Cover")).toThrow(
      "Cover image magic bytes do not match declared PNG MIME type",
    );
    expect(() => assertImageMagicBytes(new Uint8Array(11), "image/webp", "Cover")).toThrow(
      "Cover image magic bytes do not match declared WebP MIME type",
    );
  });

  it("rejects unsupported declared types", () => {
    expect(() => assertImageMagicBytes(PNG, "image/gif", "Profile")).toThrow(
      "Unsupported profile MIME type: image/gif",
    );
  });
});
