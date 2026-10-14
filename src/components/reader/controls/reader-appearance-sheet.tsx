import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { ReaderAppearanceControls } from "./reader-appearance-controls";
import type { ReaderAppearanceControlsProps } from "./reader-appearance-controls";

export interface ReaderAppearanceSheetProps extends ReaderAppearanceControlsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `icon` is the 44px square the top bar uses; `readerBar` is the thumb bar's
   * icon-over-label cell. The trigger used to be the icon shape in both bars, so the
   * bottom bar showed one bare glyph among four labelled buttons.
   */
  triggerSize?: "icon" | "readerBar";
}

/**
 * The same reading preferences as the popover, as a bottom sheet: on a phone the toolbar
 * button is at the thumb, so the panel should come up from the same edge the button sits
 * on. It is a swipe-dismissible drawer because that is the gesture a phone user reaches
 * for; both containers render `ReaderAppearanceControls`, so the choices cannot drift.
 */
export function ReaderAppearanceSheet({
  open,
  onOpenChange,
  triggerSize = "icon",
  ...controls
}: ReaderAppearanceSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerTrigger
        render={
          <Button
            variant="ghost"
            size={triggerSize}
            className={triggerSize === "icon" ? "size-11 shrink-0" : undefined}
          />
        }
        aria-label="Reading settings"
        title="Reading settings"
      >
        <Settings2 className={triggerSize === "icon" ? "size-4" : "size-5"} aria-hidden="true" />
        {triggerSize === "readerBar" ? "Settings" : null}
      </DrawerTrigger>
      <DrawerContent side="bottom">
        <DrawerHeader>
          <DrawerTitle>Reading settings</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <ReaderAppearanceControls {...controls} />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
