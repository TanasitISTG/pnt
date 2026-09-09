import { Check, GripVertical, Languages, Loader2, MoreHorizontal, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export interface ChapterActionsControlsProps {
  unpublishedCount: number;
  onPublishAll: () => void;
  publishingAll: boolean;
  missingTitleCount: number;
  onBackfillTitles: () => void;
  backfillingTitles: boolean;
  chapterCount: number;
  onReorderChapters: () => void;
  reorderDisabled: boolean;
  deletingAllTranslations: boolean;
  onDeleteAllTranslations: () => void;
}

export function ChapterActionsControls({
  unpublishedCount,
  onPublishAll,
  publishingAll,
  missingTitleCount,
  onBackfillTitles,
  backfillingTitles,
  chapterCount,
  onReorderChapters,
  reorderDisabled,
  deletingAllTranslations,
  onDeleteAllTranslations,
}: ChapterActionsControlsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" aria-label="Chapter actions" />}
      >
        <MoreHorizontal className="size-4" />
        <span className="hidden sm:inline">Chapter actions</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Maintenance</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {unpublishedCount > 0 ? (
            <DropdownMenuItem onClick={onPublishAll} disabled={publishingAll}>
              <Check className="size-4" />
              {publishingAll ? "Publishing…" : `Publish all (${unpublishedCount})`}
            </DropdownMenuItem>
          ) : null}
          {missingTitleCount > 0 ? (
            <DropdownMenuItem onClick={onBackfillTitles} disabled={backfillingTitles}>
              {backfillingTitles ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Languages className="size-4" />
              )}
              {backfillingTitles
                ? "Translating titles…"
                : `Translate titles (${missingTitleCount})`}
            </DropdownMenuItem>
          ) : null}
          {chapterCount > 1 ? (
            <DropdownMenuItem onClick={onReorderChapters} disabled={reorderDisabled}>
              <GripVertical className="size-4" />
              Reorder chapters
            </DropdownMenuItem>
          ) : null}
          {chapterCount > 0 ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDeleteAllTranslations}
              disabled={deletingAllTranslations}
            >
              <Trash2 className="size-4" />
              {deletingAllTranslations ? "Deleting…" : "Delete translations"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
