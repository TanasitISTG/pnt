import { useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { cn } from "@/lib/utils";

import {
  AVATAR_CROP_STAGE_PIXELS,
  avatarCropBoxStyle,
  avatarCropOffsetDelta,
  type AvatarCrop,
} from "./avatar-crop";
import type { StagedAvatar } from "./avatar-file";

/**
 * The circle a chosen photo is adjusted inside, before anything is uploaded. The photo
 * follows the pointer, so a drag and an arrow key describe the same movement — which is
 * what `avatarCropOffsetDelta` converts, keeping this component free of crop arithmetic.
 */

/** Screen pixels one arrow key press moves the photo; Shift takes a longer stride. */
const NUDGE_PIXELS = 8;
const COARSE_NUDGE_PIXELS = 32;

/** Screen direction per arrow key, with the photo moving the way the key points. */
const NUDGE_KEYS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface AvatarCropStageProps {
  staged: StagedAvatar;
  crop: AvatarCrop;
  onCropChange: (next: AvatarCrop) => void;
  disabled?: boolean;
}

export function AvatarCropStage({
  staged,
  crop,
  onCropChange,
  disabled = false,
}: AvatarCropStageProps) {
  const t = useTranslations("settings");
  // The crop is captured when the drag starts and every move is measured from there, so
  // the photo tracks the pointer instead of drifting with each new delta.
  const dragRef = useRef<{ pointerId: number; x: number; y: number; crop: AvatarCrop } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  const movePhoto = (dragX: number, dragY: number, from: AvatarCrop) => {
    const delta = avatarCropOffsetDelta(staged, from, AVATAR_CROP_STAGE_PIXELS, dragX, dragY);
    onCropChange({
      ...from,
      offsetX: from.offsetX + delta.offsetX,
      offsetY: from.offsetY + delta.offsetY,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Capture keeps a drag that leaves the circle going; jsdom has no such method.
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, crop };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    movePhoto(event.clientX - drag.x, event.clientY - drag.y, drag.crop);
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const direction = NUDGE_KEYS[event.key];
    if (!direction) return;

    event.preventDefault();
    const step = event.shiftKey ? COARSE_NUDGE_PIXELS : NUDGE_PIXELS;
    movePhoto(direction[0] * step, direction[1] * step, crop);
  };

  return (
    <div
      role="group"
      aria-label={t("cropStageLabel")}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
      onKeyDown={handleKeyDown}
      style={{ width: AVATAR_CROP_STAGE_PIXELS, height: AVATAR_CROP_STAGE_PIXELS }}
      className={cn(
        "relative shrink-0 touch-none overflow-hidden rounded-full border border-border bg-muted select-none",
        "focus-visible:shadow-focus focus-visible:outline-hidden",
        disabled ? "cursor-default opacity-60" : dragging ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      <img
        src={staged.source}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute top-0 left-0 max-w-none"
        style={avatarCropBoxStyle(staged, crop, AVATAR_CROP_STAGE_PIXELS)}
      />
    </div>
  );
}
