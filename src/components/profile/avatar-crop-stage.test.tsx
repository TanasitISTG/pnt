// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AVATAR_PIXELS } from "@/components/user-avatar";

import { AVATAR_CROP_STAGE_PIXELS, CENTERED_AVATAR_CROP, type AvatarCrop } from "./avatar-crop";
import { AvatarCropStage } from "./avatar-crop-stage";
import type { StagedAvatar } from "./avatar-file";

// A 600x900 source at zoom 1 shows all 600px of its width inside the circle.
const STAGED: StagedAvatar = {
  source: "data:image/png;base64,staged",
  naturalWidth: 600,
  naturalHeight: 900,
};
const IMAGE_PIXELS_PER_SCREEN_PIXEL = STAGED.naturalWidth / AVATAR_CROP_STAGE_PIXELS;

afterEach(cleanup);

function renderStage(overrides: { crop?: AvatarCrop; disabled?: boolean } = {}) {
  const onCropChange = vi.fn();
  render(
    <AvatarCropStage
      staged={STAGED}
      crop={overrides.crop ?? CENTERED_AVATAR_CROP}
      onCropChange={onCropChange}
      disabled={overrides.disabled}
    />,
  );
  return { onCropChange, stage: screen.getByRole("group", { name: /Adjust the photo/ }) };
}

describe("AvatarCropStage", () => {
  it("names the surface for assistive technology and shows the staged photo", () => {
    const { stage } = renderStage();

    expect(stage.getAttribute("tabindex")).toBe("0");
    // The preview is an image the circle clips; it carries no name of its own.
    expect(stage.querySelector("img")?.getAttribute("src")).toBe(STAGED.source);
  });

  it("is exactly the size of the large avatar, so nothing jumps when a photo is staged", () => {
    const { stage } = renderStage();

    expect(AVATAR_CROP_STAGE_PIXELS).toBe(AVATAR_PIXELS.lg);
    expect(stage.style.width).toBe(`${AVATAR_PIXELS.lg}px`);
    expect(stage.style.height).toBe(`${AVATAR_PIXELS.lg}px`);
  });

  it("moves the photo by the distance an arrow key asks for", () => {
    const { onCropChange, stage } = renderStage();

    fireEvent.keyDown(stage, { key: "ArrowRight" });

    expect(onCropChange).toHaveBeenCalledWith({
      zoom: 1,
      offsetX: -8 * IMAGE_PIXELS_PER_SCREEN_PIXEL,
      offsetY: 0,
    });
  });

  it("takes a longer stride with Shift held", () => {
    const { onCropChange, stage } = renderStage();

    fireEvent.keyDown(stage, { key: "ArrowDown", shiftKey: true });

    expect(onCropChange).toHaveBeenCalledWith({
      zoom: 1,
      offsetX: 0,
      offsetY: -32 * IMAGE_PIXELS_PER_SCREEN_PIXEL,
    });
  });

  it("leaves other keys to the page", () => {
    const { onCropChange, stage } = renderStage();

    for (const key of ["a", "Enter", "Tab", "PageDown"]) {
      fireEvent.keyDown(stage, { key });
    }

    expect(onCropChange).not.toHaveBeenCalled();
  });

  it("follows the pointer while dragging, measured from where the drag started", () => {
    const { onCropChange, stage } = renderStage();

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 116, clientY: 84 });

    // One call per move, each converted to the offset the whole drag implies.
    expect(onCropChange).toHaveBeenCalledTimes(1);
    expect(onCropChange).toHaveBeenCalledWith({
      zoom: 1,
      offsetX: -16 * IMAGE_PIXELS_PER_SCREEN_PIXEL,
      offsetY: 16 * IMAGE_PIXELS_PER_SCREEN_PIXEL,
    });
  });

  it("ignores a drag that ends before it starts", () => {
    const { onCropChange, stage } = renderStage();

    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 200, clientY: 200 });

    expect(onCropChange).not.toHaveBeenCalled();
  });

  it("holds still while a save is in flight", () => {
    const { onCropChange, stage } = renderStage({ disabled: true });

    expect(stage.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(stage, { key: "ArrowRight" });
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 40, clientY: 10 });

    expect(onCropChange).not.toHaveBeenCalled();
  });
});
