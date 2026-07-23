import { describe, it, expect } from "vitest";

import { assertCoverMagicBytes } from "@/lib/novel.functions";

describe("assertCoverMagicBytes", () => {
  it("passes valid PNG magic bytes", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => assertCoverMagicBytes(pngHeader, "image/png")).not.toThrow();
  });

  it("passes valid JPEG magic bytes", () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => assertCoverMagicBytes(jpegHeader, "image/jpeg")).not.toThrow();
  });

  it("passes valid WebP magic bytes", () => {
    const webpHeader = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00,
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
    ]);
    expect(() => assertCoverMagicBytes(webpHeader, "image/webp")).not.toThrow();
  });

  it("rejects mismatched magic bytes", () => {
    const invalidHeader = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(() => assertCoverMagicBytes(invalidHeader, "image/png")).toThrow(
      "Cover image magic bytes do not match declared PNG MIME type",
    );
    expect(() => assertCoverMagicBytes(invalidHeader, "image/jpeg")).toThrow(
      "Cover image magic bytes do not match declared JPEG MIME type",
    );
    expect(() => assertCoverMagicBytes(invalidHeader, "image/webp")).toThrow(
      "Cover image magic bytes do not match declared WebP MIME type",
    );
  });

  it("rejects unsupported MIME types", () => {
    const buf = new Uint8Array([0x00]);
    expect(() => assertCoverMagicBytes(buf, "image/gif")).toThrow(
      "Unsupported cover MIME type: image/gif",
    );
  });
});
