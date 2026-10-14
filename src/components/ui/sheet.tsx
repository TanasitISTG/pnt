"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A panel that travels in from an edge: the mobile navigation, the reader's chapter
 * list, a detail view that should not steal the whole screen. Built on the dialog
 * primitive so focus trapping, escape, and the outside-click dismissal are the same
 * as every modal — the only difference is geometry and motion.
 */
function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

/*
 * A side sheet is defined by `inset-y-0` alone, never by a `dvh` height: the two together
 * resolve to the height, so on a phone whose dynamic viewport is shorter than the layout
 * viewport the panel stopped above the bottom edge and left the page showing underneath.
 */
const SIDE_CLASSES = {
  start: "inset-y-0 left-0 w-[min(20rem,88vw)] border-r border-border overlay-slide-start",
  end: "inset-y-0 right-0 w-[min(24rem,88vw)] border-l border-border overlay-slide-end",
  bottom: "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t border-border overlay-sheet",
} as const;

function SheetContent({
  className,
  children,
  side = "start",
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: keyof typeof SIDE_CLASSES;
  showCloseButton?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="overlay-fade fixed inset-0 z-50 isolate bg-charcoal/30 supports-backdrop-filter:backdrop-blur-xs dark:bg-black/60" />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex min-h-0 flex-col bg-popover text-popover-foreground shadow-pop outline-none",
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            render={<Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex shrink-0 flex-col gap-1 border-b border-border px-4 py-3 pr-14",
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-card-title text-foreground", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
