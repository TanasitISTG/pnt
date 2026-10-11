import type { CSSProperties } from "react";

/**
 * Crop geometry for the profile-photo editor, shared by the live preview and the
 * bytes that get uploaded.
 *
 * The preview is CSS and the result is a canvas `drawImage`, so both have to come
 * from one calculation: what the circle shows is exactly the square the canvas
 * encodes. Nothing here touches the DOM, which is what lets that property be tested
 * instead of eyeballed.
 */

/**
 * The square editor surface, in CSS pixels. It is the size of the large avatar, so
 * staging a photo does not resize the card; the markup and the geometry share it.
 */
export const AVATAR_CROP_STAGE_PIXELS = 96;
export const MIN_AVATAR_ZOOM = 1;
export const MAX_AVATAR_ZOOM = 3;

export interface AvatarImageSize {
  naturalWidth: number;
  naturalHeight: number;
}

/** Where the photo sits inside the circle: a zoom, plus an offset from its center. */
export interface AvatarCrop {
  zoom: number;
  /** In image pixels, and clamped to the image when applied. */
  offsetX: number;
  offsetY: number;
}

export const CENTERED_AVATAR_CROP: AvatarCrop = Object.freeze({
  zoom: MIN_AVATAR_ZOOM,
  offsetX: 0,
  offsetY: 0,
});

/** The square region of the image the avatar keeps, in image pixels. */
export interface AvatarCropRect {
  x: number;
  y: number;
  side: number;
}

/**
 * Zoom 1 keeps the whole shorter side — the center crop the server used to receive
 * unconditionally — and offsets slide that window across the image from there.
 */
export function avatarCropRect(image: AvatarImageSize, crop: AvatarCrop): AvatarCropRect {
  const zoom = clamp(crop.zoom, MIN_AVATAR_ZOOM, MAX_AVATAR_ZOOM);
  const side = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  const slackX = (image.naturalWidth - side) / 2;
  const slackY = (image.naturalHeight - side) / 2;

  return {
    side,
    x: slackX + clamp(crop.offsetX, -slackX, slackX),
    y: slackY + clamp(crop.offsetY, -slackY, slackY),
  };
}

/**
 * Placement of the image inside a `boxSide` square so that the box shows exactly
 * `avatarCropRect`. The returned transform is the same window the canvas encodes.
 */
export function avatarCropBoxStyle(
  image: AvatarImageSize,
  crop: AvatarCrop,
  boxSide: number,
): CSSProperties {
  const rect = avatarCropRect(image, crop);
  const scale = boxSide / rect.side;

  return {
    width: image.naturalWidth * scale,
    height: image.naturalHeight * scale,
    transform: `translate(${-rect.x * scale}px, ${-rect.y * scale}px)`,
  };
}

/**
 * The crop offsets a drag of `dragX`/`dragY` screen pixels implies. The photo follows
 * the pointer, so the window it shows moves the other way.
 */
export function avatarCropOffsetDelta(
  image: AvatarImageSize,
  crop: AvatarCrop,
  boxSide: number,
  dragX: number,
  dragY: number,
): { offsetX: number; offsetY: number } {
  const imagePixelsPerBoxPixel = avatarCropRect(image, crop).side / boxSide;

  return {
    offsetX: -dragX * imagePixelsPerBoxPixel,
    offsetY: -dragY * imagePixelsPerBoxPixel,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
