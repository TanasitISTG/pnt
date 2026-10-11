import sharp from "sharp";

import { COVER_WIDTHS, type CoverWidth } from "@/lib/storage/keys";

export { COVER_WIDTHS };
export type { CoverWidth };

export async function resizeCover(buffer: Uint8Array, width: CoverWidth): Promise<Uint8Array> {
  return sharp(buffer)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}
