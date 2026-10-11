import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { resizeAvatar } from "./avatar-image.server";

async function portraitBuffer(width = 600, height = 900): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 32, g: 32, b: 32, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe("resizeAvatar", () => {
  it.each([64, 128, 256] as const)("emits a square %spx WebP", async (width) => {
    const result = await resizeAvatar(await portraitBuffer(), width);
    const metadata = await sharp(result).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(width);
    expect(metadata.height).toBe(width);
  });

  it("crops to a square instead of letterboxing a portrait", async () => {
    const source = await sharp({
      create: {
        width: 200,
        height: 400,
        channels: 4,
        background: { r: 200, g: 30, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const metadata = await sharp(await resizeAvatar(source, 64)).metadata();
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
  });

  it("enlarges a source smaller than the requested width", async () => {
    const metadata = await sharp(
      await resizeAvatar(await portraitBuffer(120, 120), 256),
    ).metadata();
    expect(metadata.width).toBe(256);
  });
});
