import { Settings2 } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ReaderAppearanceControls } from "./reader-appearance-controls";
import type { ReaderAppearanceControlsProps } from "./reader-appearance-controls";

export interface ReaderAppearancePanelProps extends ReaderAppearanceControlsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The reader's settings control where a popover belongs: pointer-sized screens, where
 * the panel grows from the toolbar button the reader just pressed and leaves the prose
 * on screen. The narrow-screen container is the sheet.
 */
export function ReaderAppearancePanel({
  open,
  onOpenChange,
  ...controls
}: ReaderAppearancePanelProps) {
  const t = useTranslations("reader");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}
        aria-label={t("readingSettings")}
        title={t("readingSettings")}
      >
        <Settings2 className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-[min(23rem,calc(100vw-2rem))]">
        <PopoverTitle className="mb-3">{t("readingSettings")}</PopoverTitle>
        <ReaderAppearanceControls {...controls} />
      </PopoverContent>
    </Popover>
  );
}
