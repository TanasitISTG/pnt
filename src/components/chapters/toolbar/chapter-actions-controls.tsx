import { Check, GripVertical, Languages, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "use-intl";

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
  blockedCount: number;
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
  blockedCount,
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
  const t = useTranslations("studio");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" aria-label={t("chapterActions")} />}
      >
        <MoreHorizontal className="size-4" />
        <span className="hidden sm:inline">{t("chapterActions")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("maintenance")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {readyUnpublishedCount > 0 ? (
            <DropdownMenuItem onClick={onPublishAll} disabled={publishingAll}>
              <Check className="size-4" />
              {publishingAll
                ? t("publishingChapters")
                : t("publishReadyChapters", { count: readyUnpublishedCount })}
            </DropdownMenuItem>
          ) : null}
          {unreadyCount > 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("notReadyToPublish", { count: unreadyCount })}
            </p>
          ) : null}
          {blockedCount > 0 ? (
            <p className="px-2 py-1.5 text-xs text-warning">
              {t("publicationBlockedCount", { count: blockedCount })}
            </p>
          ) : null}
          {missingTitleCount > 0 ? (
            <DropdownMenuItem onClick={onBackfillTitles} disabled={backfillingTitles}>
              {backfillingTitles ? <Spinner /> : <Languages className="size-4" />}
              {backfillingTitles
                ? t("translatingTitles")
                : t("translateTitles", { count: missingTitleCount })}
            </DropdownMenuItem>
          ) : null}
          {chapterCount > 1 ? (
            <DropdownMenuItem onClick={onReorderChapters} disabled={reorderDisabled}>
              <GripVertical className="size-4" />
              {t("reorderChapters")}
            </DropdownMenuItem>
          ) : null}
          {chapterCount > 0 ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={onDeleteAllTranslations}
              disabled={deletingAllTranslations}
            >
              <Trash2 className="size-4" />
              {deletingAllTranslations ? t("deletingTranslations") : t("deleteTranslations")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
