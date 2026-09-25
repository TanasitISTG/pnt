import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { resizeCover } from "./cover-image.server";

describe("resizeCover", () => {
  it("creates a 320px-wide WebP without changing the aspect ratio", async () => {
    const input = await sharp({
      create: {
        width: 800,
        height: 1200,
        channels: 4,
        background: { r: 32, g: 32, b: 32, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await resizeCover(input, 320);
    const metadata = await sharp(result).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(480);
  });

  it("does not enlarge a source narrower than the requested width", async () => {
    const input = await sharp({
      create: {
        width: 100,
        height: 150,
        channels: 4,
        background: { r: 32, g: 32, b: 32, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await resizeCover(input, 320);
    const metadata = await sharp(result).metadata();

    expect(metadata.width).toBe(100);
  });
});
