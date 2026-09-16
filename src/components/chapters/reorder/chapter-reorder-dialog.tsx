import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { GripVertical } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sortable, SortableItem, SortableItemHandle } from "@/components/ui/sortable";
import { Spinner } from "@/components/ui/spinner";
import type { ChapterRow } from "@/components/chapters/types";

export interface ChapterReorderDialogProps {
  chapters: ChapterRow[];
  onOpenChange: (open: boolean) => void;
  onSave: (chapterIds: string[]) => Promise<unknown>;
}

const chapterOrderSchema = z
  .object({
    chapterIds: z.array(z.string().min(1)).min(1),
  })
  .refine((value) => new Set(value.chapterIds).size === value.chapterIds.length, {
    message: "Chapter IDs must be unique",
    path: ["chapterIds"],
  });

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
  onOpenChange,
  onSave,
}: ChapterReorderDialogProps) {
  const initialOrder = useMemo(() => chapters.map((chapter) => chapter.id), [chapters]);
  const chapterLookup = useMemo(
    () => new Map(chapters.map((chapter) => [chapter.id, chapter])),
    [chapters],
  );
  const [numberSlots] = useState(() => chapters.map((chapter) => chapter.number));
  const [listReady, setListReady] = useState(false);
  const form = useForm({
    defaultValues: {
      chapterIds: initialOrder,
    },
    validators: {
      onSubmit: chapterOrderSchema,
    },
    onSubmit: async ({ value }) => {
      const parsed = chapterOrderSchema.parse(value);
      const changed = parsed.chapterIds.some(
        (chapterId, index) => chapterId !== initialOrder[index],
      );
      if (!changed) return;
      try {
        await onSave(parsed.chapterIds);
        onOpenChange(false);
      } catch {
        // The mutation owns the error toast; keep the dialog open for another attempt.
      }
    },
  });

  const [chapterIds, isSubmitting] = useStore(
    form.store,
    (state) => [state.values.chapterIds, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  useEffect(() => scheduleNextFrame(() => setListReady(true)), []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && form.state.isSubmitting) return;
      onOpenChange(nextOpen);
    },
    [form, onOpenChange],
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-4 sm:max-w-2xl"
        onKeyDown={handleDialogKeyDown}
        showCloseButton={false}
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          className="flex min-h-0 flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Reorder chapters</DialogTitle>
            <DialogDescription>
              Drag chapters into the order they should appear in the reader.
            </DialogDescription>
          </DialogHeader>

          <form.Field name="chapterIds" mode="array">
            {(field) => {
              const orderedChapters = chapterIds
                .map((chapterId) => chapterLookup.get(chapterId))
                .filter((chapter): chapter is ChapterRow => Boolean(chapter));
              const orderChanged =
                chapterIds.length !== initialOrder.length ||
                chapterIds.some((chapterId, index) => chapterId !== initialOrder[index]);

              return (
                <>
                  {listReady ? (
                    <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border p-2">
                      <Sortable
                        value={orderedChapters}
                        onValueChange={(nextChapters) =>
                          field.handleChange(nextChapters.map((chapter) => chapter.id))
                        }
                        getItemValue={(chapter) => chapter.id}
                      >
                        {orderedChapters.map((chapter, index) => {
                          const displayTitle = chapter.translatedTitle ?? chapter.title;
                          const slotNumber = numberSlots[index] ?? String(index + 1);

                          return (
                            <SortableItem
                              key={chapter.id}
                              value={chapter.id}
                              disabled={isSubmitting}
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
                              <span className="min-w-0 truncate text-sm text-foreground">
                                {displayTitle}
                              </span>
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
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={!orderChanged || isSubmitting}>
                      {isSubmitting && <Spinner />}
                      {isSubmitting ? "Saving…" : "Save order"}
                    </Button>
                  </DialogFooter>
                </>
              );
            }}
          </form.Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
