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
  return (
    <Dialog open onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-2xl sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reorder chapters</DialogTitle>
          <DialogDescription>
            Drag chapters into the order they should appear in the reader.
          </DialogDescription>
        </DialogHeader>
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-32 items-center justify-center rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground"
        >
          Preparing {chapterCount} chapters…
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button disabled>{saving ? "Saving…" : "Preparing…"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
