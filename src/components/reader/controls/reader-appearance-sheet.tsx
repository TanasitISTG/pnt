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
  ...controls
}: ReaderAppearanceSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <DrawerTrigger
        render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}
        aria-label="Reading settings"
        title="Reading settings"
      >
        <Settings2 className="size-4" aria-hidden="true" />
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
