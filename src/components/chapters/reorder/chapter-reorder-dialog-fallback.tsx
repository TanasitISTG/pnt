import { useTranslations } from "use-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ChapterReorderDialogFallbackProps {
  chapterCount: number;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChapterReorderDialogFallback({
  chapterCount,
  saving,
  onOpenChange,
}: ChapterReorderDialogFallbackProps) {
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  return (
    <Dialog open onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-2xl sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("reorderChapters")}</DialogTitle>
          <DialogDescription>{t("reorderDescription")}</DialogDescription>
        </DialogHeader>
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-32 items-center justify-center rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground"
        >
          {t("reorderPreparing", { count: chapterCount })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {tCommon("cancel")}
          </Button>
          <Button disabled>{saving ? tCommon("saving") : t("reorderPreparingShort")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
