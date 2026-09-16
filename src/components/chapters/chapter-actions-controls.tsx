import { Check, GripVertical, Languages, MoreHorizontal, Trash2 } from "lucide-react";

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
import { Spinner } from "@/components/ui/spinner";

export interface ChapterActionsControlsProps {
  readyUnpublishedCount: number;
  unreadyCount: number;
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
  readyUnpublishedCount,
  unreadyCount,
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
          {readyUnpublishedCount > 0 ? (
            <DropdownMenuItem onClick={onPublishAll} disabled={publishingAll}>
              <Check className="size-4" />
              {publishingAll ? "Publishing…" : `Publish ready chapters (${readyUnpublishedCount})`}
            </DropdownMenuItem>
          ) : null}
          {unreadyCount > 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {unreadyCount} chapter{unreadyCount === 1 ? "" : "s"} not ready to publish
            </p>
          ) : null}
          {missingTitleCount > 0 ? (
            <DropdownMenuItem onClick={onBackfillTitles} disabled={backfillingTitles}>
              {backfillingTitles ? <Spinner /> : <Languages className="size-4" />}
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
