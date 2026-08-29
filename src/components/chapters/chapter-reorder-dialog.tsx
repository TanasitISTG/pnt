import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/ui/sortable";
import type { ChapterRow } from "./types";

export interface ChapterReorderDialogProps {
  chapters: ChapterRow[];
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (chapterIds: string[]) => Promise<unknown>;
}

function scheduleNextFrame(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  if (typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(frame);
  }

  const timeout = window.setTimeout(callback, 0);
  return () => window.clearTimeout(timeout);
}
function handleDialogKeyDown(event: KeyboardEvent) {
  if (event.key.startsWith("Arrow")) {
    (event as KeyboardEvent & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
  }
}

export function ChapterReorderDialog({
  chapters,
  open,
  saving,
  onOpenChange,
  onSave,
}: ChapterReorderDialogProps) {
  const chaptersRef = useRef(chapters);
  const initialOrderRef = useRef(chapters.map((chapter) => chapter.id));
  const [orderedChapters, setOrderedChapters] = useState(() => chapters);
  const [numberSlots, setNumberSlots] = useState(() => chapters.map((chapter) => chapter.number));
  const [listReady, setListReady] = useState(false);

  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  useEffect(() => {
    if (!open) {
      setListReady(false);
      return;
    }

    const nextChapters = chaptersRef.current;
    initialOrderRef.current = nextChapters.map((chapter) => chapter.id);
    setOrderedChapters(nextChapters);
    setNumberSlots(nextChapters.map((chapter) => chapter.number));
    setListReady(false);

    return scheduleNextFrame(() => setListReady(true));
  }, [open]);

  const orderChanged =
    orderedChapters.length !== initialOrderRef.current.length ||
    orderedChapters.some((chapter, index) => chapter.id !== initialOrderRef.current[index]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && saving) return;
      onOpenChange(nextOpen);
    },
    [onOpenChange, saving],
  );

  const handleSave = useCallback(async () => {
    if (!orderChanged || saving) return;

    try {
      await onSave(orderedChapters.map((chapter) => chapter.id));
      onOpenChange(false);
    } catch {
      // The mutation owns the error toast; keep the dialog open for another attempt.
    }
  }, [onOpenChange, onSave, orderChanged, orderedChapters, saving]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-4 sm:max-w-2xl"
        onKeyDown={handleDialogKeyDown}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Reorder chapters</DialogTitle>
          <DialogDescription>
            Drag chapters into the order they should appear in the reader.
          </DialogDescription>
        </DialogHeader>

        {listReady ? (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border p-2">
            <Sortable
              value={orderedChapters}
              onValueChange={setOrderedChapters}
              getItemValue={(chapter) => chapter.id}
            >
              {orderedChapters.map((chapter, index) => {
                const displayTitle = chapter.translatedTitle ?? chapter.title;
                const slotNumber = numberSlots[index] ?? String(index + 1);

                return (
                  <SortableItem
                    key={chapter.id}
                    value={chapter.id}
                    disabled={saving}
                    render={
                      <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 data-[dragging=true]:bg-muted" />
                    }
                  >
                    <SortableItemHandle
                      render={<Button variant="ghost" size="icon-sm" />}
                      aria-label={`Reorder chapter ${Number(slotNumber)}: ${displayTitle}`}
                      title="Reorder chapter"
                    >
                      <GripVertical className="size-4 text-muted-foreground" />
                    </SortableItemHandle>
                    <span className="w-10 shrink-0 text-right font-mono text-muted-foreground">
                      {Number(slotNumber)}
                    </span>
                    <span className="min-w-0 truncate text-sm text-foreground">{displayTitle}</span>
                  </SortableItem>
                );
              })}
            </Sortable>
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-32 items-center justify-center rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground"
          >
            Preparing {chapters.length} chapters…
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!orderChanged || saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : "Save order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
