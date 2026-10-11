// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedAvatar } from "@/lib/profile/types";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

// Reading a file and re-encoding the crop are DOM work jsdom cannot do; what this suite
// owns is the order they happen in — specifically that nothing uploads by itself.
const mocks = vi.hoisted(() => ({
  stageAvatarFile: vi.fn(),
  encodeAvatarCrop: vi.fn(),
}));
vi.mock("./avatar-file", () => ({
  stageAvatarFile: mocks.stageAvatarFile,
  encodeAvatarCrop: mocks.encodeAvatarCrop,
}));

const { MAX_PROFILE_PHOTO_BYTES, ProfilePhotoCard } = await import("./profile-photo-card");

const STAGED = {
  source: "data:image/png;base64,staged",
  naturalWidth: 600,
  naturalHeight: 900,
};
const ENCODED = { image: "ENCODED", imageMime: "image/webp" } as const;
const STORED: ResolvedAvatar = { url: "https://cdn.test/old.webp", srcSet: null };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

interface RenderOverrides {
  avatar?: ResolvedAvatar | null;
  onUpload?: () => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
}

function renderCard(overrides: RenderOverrides = {}) {
  const onUpload = vi.fn(overrides.onUpload ?? (async () => true));
  const onRemove = vi.fn(overrides.onRemove ?? (async () => true));

  render(
    <ProfilePhotoCard
      name="tana"
      avatar={overrides.avatar ?? null}
      onUpload={onUpload}
      onRemove={onRemove}
    />,
  );

  return {
    input: screen.getByLabelText("Profile photo file") as HTMLInputElement,
    onUpload,
    onRemove,
  };
}

function fileOf(size: number, type = "image/png"): File {
  return new File([new Uint8Array(size)], "photo.png", { type });
}

const cropStage = () => screen.queryByRole("group", { name: /Adjust the photo/ });

/** Chooses a file and waits for the preview, which is what the card stages on. */
async function choosePhoto(input: HTMLInputElement) {
  fireEvent.change(input, { target: { files: [fileOf(1024)] } });
  await waitFor(() => expect(cropStage()).not.toBeNull());
}

describe("ProfilePhotoCard", () => {
  it("shows initials when there is no photo, and no remove action", () => {
    const { onRemove } = renderCard();

    expect(screen.getByText("TA")).toBeDefined();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("rejects a file over the size ceiling without reading or uploading it", async () => {
    const { input, onUpload } = renderCard();

    fireEvent.change(input, { target: { files: [fileOf(MAX_PROFILE_PHOTO_BYTES + 1)] } });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Profile photo must be smaller than 2MB"),
    );
    expect(mocks.stageAvatarFile).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("rejects a file type the server would refuse without reading or uploading it", async () => {
    const { input, onUpload } = renderCard();

    fireEvent.change(input, { target: { files: [fileOf(1024, "image/gif")] } });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Profile photo must be a JPG, PNG or WebP image"),
    );
    expect(mocks.stageAvatarFile).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("ignores an empty selection", () => {
    const { input, onUpload } = renderCard();

    fireEvent.change(input, { target: { files: [] } });

    expect(mocks.stageAvatarFile).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows the chosen photo as a preview without uploading it", async () => {
    mocks.stageAvatarFile.mockResolvedValue(STAGED);
    const { input, onUpload } = renderCard();

    await choosePhoto(input);

    expect(cropStage()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    // The stored photo is still the one in the shell; the preview replaced the slot.
    expect(screen.queryByText("TA")).toBeNull();
    expect(mocks.encodeAvatarCrop).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("uploads the cropped photo only once it is confirmed", async () => {
    mocks.stageAvatarFile.mockResolvedValue(STAGED);
    mocks.encodeAvatarCrop.mockResolvedValue(ENCODED);
    const { input, onUpload } = renderCard();

    await choosePhoto(input);
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith(ENCODED);
    expect(mocks.encodeAvatarCrop).toHaveBeenCalledWith(STAGED, {
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // The preview is done; the card is back to showing the stored photo.
    await waitFor(() => expect(cropStage()).toBeNull());
  });

  it("discards a preview on cancel without touching the server", async () => {
    mocks.stageAvatarFile.mockResolvedValue(STAGED);
    const { input, onUpload } = renderCard({ avatar: STORED });

    await choosePhoto(input);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(cropStage()).toBeNull();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeDefined();
    expect(mocks.encodeAvatarCrop).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("keeps the preview and the crop when the upload is refused", async () => {
    mocks.stageAvatarFile.mockResolvedValue(STAGED);
    mocks.encodeAvatarCrop.mockResolvedValue(ENCODED);
    const { input, onUpload } = renderCard({ onUpload: async () => false });

    await choosePhoto(input);
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    // Retrying must not cost the admin their adjustment.
    expect(cropStage()).not.toBeNull();
  });

  it("reports a file it cannot read instead of uploading anything", async () => {
    mocks.stageAvatarFile.mockRejectedValue(new Error("unreadable"));
    const { input, onUpload } = renderCard();

    fireEvent.change(input, { target: { files: [fileOf(1024)] } });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not read that image file"));
    expect(cropStage()).toBeNull();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("removes a stored photo", async () => {
    const { onRemove } = renderCard({ avatar: STORED });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
  });

  it("shows a loading state on the remove button while the removal is in flight", async () => {
    // A removal that takes a moment, so the busy state can be observed.
    const onRemove = vi.fn(
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20)),
    );
    renderCard({ avatar: STORED, onRemove });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    // One busy step at a time: the spinner is on the button that was pressed (which is
    // why its name now also carries the spinner's label), and neither button can be
    // pressed again while it runs.
    expect(screen.getByRole("status")).toBeDefined();
    expect((screen.getByRole("button", { name: /Remove/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Change photo" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
