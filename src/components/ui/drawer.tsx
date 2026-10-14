"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A panel that travels in from an edge and is dragged back out with the pointer.
 *
 * This is the one overlay in the system that carries a gesture: Base UI supplies the
 * drag physics (1:1 tracking, velocity-based dismissal, snap points), and the panel
 * only declares how the gesture shows up on screen. The two edge classes in
 * `globals.css` translate the popup through `--drawer-swipe-movement-*`, so the panel
 * follows the finger and falls back to its resting position when the gesture ends.
 *
 * Focus trapping, Escape and the outside press are the dialog primitive's, because a
 * drawer that cannot be closed from the keyboard is not a drawer, it is a trap.
 */
function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

const SIDE_CLASSES = {
  bottom: {
    // `justify-stretch` is not a `justify-content` value, so the panel fell back to
    // `normal` (flex-start) and shrank to its content: on a 390px phone the reading
    // settings sheet measured 290px and hugged the left edge instead of spanning the
    // bottom. The viewport centres, the popup fills it up to its cap.
    viewport: "items-end justify-center",
    // A bottom sheet sits against the home indicator, so its own padding clears it; a
    // caller should never have to reach for the inset. The cap keeps it a sheet rather
    // than a full-bleed panel on a tablet.
    popup:
      "overlay-drawer-bottom w-full max-w-[min(32rem,100%)] max-h-[85dvh] rounded-t-2xl border-t pb-safe-bottom",
  },
  end: {
    // The viewport stretches its child, so the panel reaches the bottom of the viewport it
    // covers without a `dvh` height — which would win over the stretch and could stop short.
    viewport: "items-stretch justify-end",
    popup: "overlay-drawer-end w-[min(24rem,88vw)] border-l",
  },
} as const;

/** The grip that tells a pointer this panel can be pulled. Decorative. */
function DrawerGrip({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-grip"
      aria-hidden="true"
      className={cn("mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-border-strong", className)}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  side = "bottom",
  showCloseButton = true,
  showGrip = true,
  ...props
}: DrawerPrimitive.Popup.Props & {
  side?: keyof typeof SIDE_CLASSES;
  showCloseButton?: boolean;
  showGrip?: boolean;
}) {
  const classes = SIDE_CLASSES[side];
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop className="overlay-fade fixed inset-0 z-50 isolate bg-charcoal/30 supports-backdrop-filter:backdrop-blur-xs dark:bg-black/60" />
      <DrawerPrimitive.Viewport className={cn("fixed inset-0 z-50 flex", classes.viewport)}>
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "flex min-h-0 flex-col border-border bg-popover text-popover-foreground shadow-pop outline-none",
            classes.popup,
            className,
          )}
          {...props}
        >
          {showGrip && side === "bottom" ? <DrawerGrip /> : null}
          {children}
          {showCloseButton ? (
            <DrawerPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DrawerPrimitive.Close>
          ) : null}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex shrink-0 flex-col gap-1 border-b border-border px-5 py-4 pr-14",
        className,
      )}
      {...props}
    />
  );
}

/** The scrollable region of a drawer; the panel itself never scrolls as a whole. */
function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-body"
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4", className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("shrink-0 border-t border-border px-5 py-3", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-card-title text-foreground", className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerGrip,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
};
