import sharp from "sharp";

import { AVATAR_WIDTHS, type AvatarWidth } from "@/lib/storage/keys";

export { AVATAR_WIDTHS };
export type { AvatarWidth };

/**
 * Square re-encode at the requested width. The shell, dropdown, and profile page
 * render the photo in a circle, so a center crop at upload time is what keeps a
 * portrait from being squashed into an ellipse.
 */
export async function resizeAvatar(buffer: Uint8Array, width: AvatarWidth): Promise<Uint8Array> {
  return sharp(buffer)
    .rotate()
    .resize({ width, height: width, fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();
}
