import sharp from "sharp";

export const COVER_WIDTHS = [320, 480, 640] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];

export async function resizeCover(buffer: Uint8Array, width: CoverWidth): Promise<Uint8Array> {
  return sharp(buffer)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}
