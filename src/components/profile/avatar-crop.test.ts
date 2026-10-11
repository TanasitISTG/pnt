import { describe, expect, it } from "vitest";

import {
  AVATAR_CROP_STAGE_PIXELS,
  CENTERED_AVATAR_CROP,
  MAX_AVATAR_ZOOM,
  MIN_AVATAR_ZOOM,
  avatarCropBoxStyle,
  avatarCropOffsetDelta,
  avatarCropRect,
  type AvatarCrop,
  type AvatarImageSize,
} from "./avatar-crop";

const LANDSCAPE: AvatarImageSize = { naturalWidth: 800, naturalHeight: 600 };
const PORTRAIT: AvatarImageSize = { naturalWidth: 600, naturalHeight: 900 };

const crop = (overrides: Partial<AvatarCrop> = {}): AvatarCrop => ({
  ...CENTERED_AVATAR_CROP,
  ...overrides,
});

interface BoxStyle {
  width: string;
  height: string;
  transform: string;
}

function boxStyle(image: AvatarImageSize, at: AvatarCrop): BoxStyle {
  return avatarCropBoxStyle(image, at, AVATAR_CROP_STAGE_PIXELS) as BoxStyle;
}

/**
 * The point of the image shown at a given spot of the box, read back out of the same
 * transform the browser applies. This is how a test can ask what the preview shows.
 */
function imagePointAt(image: AvatarImageSize, at: AvatarCrop, boxX: number, boxY: number) {
  const style = boxStyle(image, at);
  const [translateX = Number.NaN, translateY = Number.NaN] = [
    ...style.transform.matchAll(/(-?[\d.]+)px/g),
  ].map((match) => Number(match[1]));
  const scaleX = Number(style.width) / image.naturalWidth;
  const scaleY = Number(style.height) / image.naturalHeight;

  return {
    x: (boxX - translateX) / scaleX,
    y: (boxY - translateY) / scaleY,
  };
}

describe("avatarCropRect", () => {
  it("keeps the whole shorter side when nothing is zoomed or offset", () => {
    expect(avatarCropRect(LANDSCAPE, CENTERED_AVATAR_CROP)).toEqual({
      x: 100,
      y: 0,
      side: 600,
    });
    expect(avatarCropRect(PORTRAIT, CENTERED_AVATAR_CROP)).toEqual({
      x: 0,
      y: 150,
      side: 600,
    });
  });

  it("narrows the window and re-centers it as the zoom rises", () => {
    expect(avatarCropRect(LANDSCAPE, crop({ zoom: 2 }))).toEqual({ x: 250, y: 150, side: 300 });
    expect(avatarCropRect(PORTRAIT, crop({ zoom: 3 }))).toEqual({ x: 200, y: 350, side: 200 });
  });

  it("slides the window without changing its size", () => {
    expect(avatarCropRect(PORTRAIT, crop({ offsetY: -100 }))).toEqual({
      x: 0,
      y: 50,
      side: 600,
    });
  });

  it.each([
    ["above the maximum", { zoom: 12 }, MAX_AVATAR_ZOOM],
    ["below the minimum", { zoom: 0.1 }, MIN_AVATAR_ZOOM],
  ])("clamps a zoom %s", (_case, overrides, expected) => {
    const rect = avatarCropRect(LANDSCAPE, crop(overrides));
    expect(rect.side).toBe(Math.min(LANDSCAPE.naturalWidth, LANDSCAPE.naturalHeight) / expected);
  });

  it("clamps offsets so the window can never leave the image", () => {
    // A square image has no slack at all, so no offset can move the window.
    expect(
      avatarCropRect({ naturalWidth: 400, naturalHeight: 400 }, crop({ offsetX: 90 })),
    ).toEqual({
      x: 0,
      y: 0,
      side: 400,
    });

    const pushed = avatarCropRect(LANDSCAPE, crop({ offsetX: 10_000, offsetY: -10_000, zoom: 2 }));
    expect(pushed.x + pushed.side).toBe(LANDSCAPE.naturalWidth);
    expect(pushed.y).toBe(0);
  });
});

describe("avatar preview geometry", () => {
  it.each([
    ["landscape", LANDSCAPE, CENTERED_AVATAR_CROP],
    ["portrait", PORTRAIT, CENTERED_AVATAR_CROP],
    [
      "zoomed and pushed past a corner",
      LANDSCAPE,
      crop({ zoom: 2.5, offsetX: 9_999, offsetY: -9_999 }),
    ],
    ["square source", { naturalWidth: 512, naturalHeight: 512 }, crop({ zoom: 1.4, offsetX: 12 })],
  ] as const)("keeps the box fully covered for a %s source", (_case, image, at) => {
    // Whatever the crop, the circle can never show a gap: both corners of the box have
    // to land on real pixels of the image. The tolerance covers the float round trip
    // through the transform string.
    const slack = 1e-6;
    const topLeft = imagePointAt(image, at, 0, 0);
    const bottomRight = imagePointAt(image, at, AVATAR_CROP_STAGE_PIXELS, AVATAR_CROP_STAGE_PIXELS);

    expect(topLeft.x).toBeGreaterThanOrEqual(-slack);
    expect(topLeft.y).toBeGreaterThanOrEqual(-slack);
    expect(bottomRight.x).toBeLessThanOrEqual(image.naturalWidth + slack);
    expect(bottomRight.y).toBeLessThanOrEqual(image.naturalHeight + slack);
  });

  it("shows exactly the square the upload encodes", () => {
    const at = crop({ zoom: 1.5, offsetX: 40, offsetY: -75 });
    const rect = avatarCropRect(LANDSCAPE, at);

    // The corners of the box are the corners of the crop rect, which is the property
    // that makes the preview trustworthy: the canvas draws this same rect.
    expect(imagePointAt(LANDSCAPE, at, 0, 0)).toEqual({
      x: expect.closeTo(rect.x, 6),
      y: expect.closeTo(rect.y, 6),
    });
    expect(imagePointAt(LANDSCAPE, at, AVATAR_CROP_STAGE_PIXELS, AVATAR_CROP_STAGE_PIXELS)).toEqual(
      {
        x: expect.closeTo(rect.x + rect.side, 6),
        y: expect.closeTo(rect.y + rect.side, 6),
      },
    );
  });
});

describe("avatarCropOffsetDelta", () => {
  it("moves the window against the pointer, by the distance dragged on screen", () => {
    // A landscape source has room to slide sideways; a portrait one has none at zoom 1.
    const before = avatarCropRect(LANDSCAPE, CENTERED_AVATAR_CROP);
    const delta = avatarCropOffsetDelta(
      LANDSCAPE,
      CENTERED_AVATAR_CROP,
      AVATAR_CROP_STAGE_PIXELS,
      16,
      0,
    );
    const after = avatarCropRect(LANDSCAPE, crop({ offsetX: delta.offsetX }));

    // Dragging right by 16px of a 160px box moves the crop window 16px left on screen.
    const boxScale = AVATAR_CROP_STAGE_PIXELS / before.side;
    expect((after.x - before.x) * boxScale).toBeCloseTo(-16, 6);
  });

  it("stops at the image edge instead of dragging a gap into the circle", () => {
    const before = avatarCropRect(LANDSCAPE, CENTERED_AVATAR_CROP);
    const delta = avatarCropOffsetDelta(
      LANDSCAPE,
      CENTERED_AVATAR_CROP,
      AVATAR_CROP_STAGE_PIXELS,
      10_000,
      0,
    );
    const after = avatarCropRect(LANDSCAPE, crop({ offsetX: delta.offsetX }));

    expect(after.x).toBe(0);
    expect(after.x).toBeLessThan(before.x);
  });

  it("ignores how far the image is zoomed when converting screen distance", () => {
    const zoomedIn = avatarCropOffsetDelta(
      PORTRAIT,
      crop({ zoom: MAX_AVATAR_ZOOM }),
      AVATAR_CROP_STAGE_PIXELS,
      16,
      0,
    );

    // The window is three times smaller, so the same drag moves it three times further.
    expect(zoomedIn.offsetX).toBeCloseTo(
      avatarCropOffsetDelta(PORTRAIT, CENTERED_AVATAR_CROP, AVATAR_CROP_STAGE_PIXELS, 16, 0)
        .offsetX / MAX_AVATAR_ZOOM,
      6,
    );
  });
});
