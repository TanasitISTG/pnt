import * as React from "react";

import { cn } from "@/lib/utils";

const SHAPE_CLASSES = {
  /** Text rows and small blocks. */
  default: "rounded-md",
  /** A placeholder for a card or a toolbar-sized panel. */
  panel: "rounded-xl",
  /** A placeholder for cover art, which is always 3:4 and never rounded inside a card. */
  media: "aspect-3/4 rounded-none",
} as const;

interface SkeletonProps extends React.ComponentProps<"div"> {
  shape?: keyof typeof SHAPE_CLASSES;
}

/**
 * One loading language for the whole app. Data-only shapes (no icons, no copy) so a
 * pending region matches the layout it will become; the pulse is motion-safe because a
 * looping animation is decorative. Shape is a prop, not a className, so the primitive
 * stays the single owner of its own geometry.
 */
function Skeleton({ className, shape = "default", ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("motion-safe:animate-pulse bg-surface-inset", SHAPE_CLASSES[shape], className)}
      {...props}
    />
  );
}

export { Skeleton };
