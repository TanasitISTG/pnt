import type { UpdateProfileImageInput } from "@/lib/profile/schemas";
import { blobToDataUrl } from "@/lib/utils";

import { avatarCropRect, type AvatarCrop, type AvatarImageSize } from "./avatar-crop";

/**
 * The browser boundary of the photo editor: reading a chosen file and re-encoding the
 * confirmed crop. Both halves are DOM work, so they live behind two functions the card
 * can call in order — nothing here ever touches the network.
 */

/** The widest variant the app serves is 256px; 512 stays crisp on a 2x screen. */
export const AVATAR_UPLOAD_PIXELS = 512;

/** A chosen file that is waiting for the admin to confirm what the circle keeps. */
export interface StagedAvatar extends AvatarImageSize {
  /** Data URL of the original file: nothing to revoke, and re-readable when encoding. */
  source: string;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("unreadable image")), { once: true });
    image.src = source;
  });
}

/** Decodes a chosen file so the editor can show it; rejects when a browser cannot. */
export async function stageAvatarFile(file: File): Promise<StagedAvatar> {
  const source = await blobToDataUrl(file);
  const image = await loadImage(source);
  if (image.naturalWidth === 0 || image.naturalHeight === 0) throw new Error("empty image");

  return { source, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
}

/**
 * Re-encodes the confirmed crop into the payload the server accepts. WebP is the
 * target; a browser that cannot encode it falls back to PNG, and the declared type
 * follows the bytes the browser actually produced.
 */
export async function encodeAvatarCrop(
  staged: StagedAvatar,
  crop: AvatarCrop,
): Promise<UpdateProfileImageInput> {
  const image = await loadImage(staged.source);
  const rect = avatarCropRect(staged, crop);

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_UPLOAD_PIXELS;
  canvas.height = AVATAR_UPLOAD_PIXELS;
  canvas
    .getContext("2d")
    ?.drawImage(
      image,
      rect.x,
      rect.y,
      rect.side,
      rect.side,
      0,
      0,
      AVATAR_UPLOAD_PIXELS,
      AVATAR_UPLOAD_PIXELS,
    );

  const encoded = canvas.toDataURL("image/webp", 0.85);
  const separator = encoded.indexOf(",");
  if (separator < 0 || encoded.length === separator + 1) throw new Error("unencodable image");

  return {
    image: encoded.slice(separator + 1),
    imageMime: encoded.startsWith("data:image/webp") ? "image/webp" : "image/png",
  };
}
