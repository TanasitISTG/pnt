import { Check, Languages, Loader2, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ChaptersToolbarProps {
  isAdmin: boolean;
  selectedCount: number;
  selectableCount: number;
  batchStarting: boolean;
  onBatchTranslate: () => void;
  onClearSelection: () => void;
  batchRangeFrom: string;
  batchRangeTo: string;
  onBatchRangeFromChange: (value: string) => void;
  onBatchRangeToChange: (value: string) => void;
  onSelectRange: () => void;
  unpublishedCount: number;
  onPublishAll: () => void;
  publishingAll: boolean;
  missingTitleCount: number;
  onBackfillTitles: () => void;
  backfillingTitles: boolean;
  chapterCount: number;
  deletingAllTranslations: boolean;
  onDeleteAllTranslations: () => void;
}

export function ChaptersToolbar({
  isAdmin,
  selectedCount,
  selectableCount,
  batchStarting,
  onBatchTranslate,
  onClearSelection,
  batchRangeFrom,
  batchRangeTo,
  onBatchRangeFromChange,
  onBatchRangeToChange,
  onSelectRange,
  unpublishedCount,
  onPublishAll,
  publishingAll,
  missingTitleCount,
  onBackfillTitles,
  backfillingTitles,
  chapterCount,
  deletingAllTranslations,
  onDeleteAllTranslations,
}: ChaptersToolbarProps) {
  if (!isAdmin) return null;

  return (
    <div className="flex items-center flex-wrap gap-2">
      {selectedCount > 0 && (
        <>
          <span className="text-caption text-muted-foreground shrink-0">
            {selectedCount}/{selectableCount} selected
          </span>
          <Button size="sm" onClick={onBatchTranslate} disabled={batchStarting}>
            {batchStarting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {batchStarting ? "Queueing..." : `Translate selected`}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            <X className="size-4" />
            Clear
          </Button>
        </>
      )}
      {selectedCount === 0 && (
        <div className="flex items-center flex-wrap gap-1.5">
          <Input
            type="number"
            min="1"
            className="w-16 sm:w-20 h-8 text-xs"
            placeholder="from"
            value={batchRangeFrom}
            onChange={(e) => onBatchRangeFromChange(e.target.value)}
          />
          <span className="text-caption text-muted-foreground">–</span>
          <Input
            type="number"
            min="1"
            className="w-16 sm:w-20 h-8 text-xs"
            placeholder="to"
            value={batchRangeTo}
            onChange={(e) => onBatchRangeToChange(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={onSelectRange}>
            Select range
          </Button>
        </div>
      )}
      {unpublishedCount > 0 && (
        <Button variant="outline" size="sm" onClick={onPublishAll} disabled={publishingAll}>
          <Check className="size-4" />
          {publishingAll ? "Publishing..." : `Publish all (${unpublishedCount})`}
        </Button>
      )}
      {missingTitleCount > 0 && (
        <Button variant="outline" size="sm" onClick={onBackfillTitles} disabled={backfillingTitles}>
          <Languages className="size-4" />
          {backfillingTitles ? "Translating titles..." : `Translate titles (${missingTitleCount})`}
        </Button>
      )}
      {chapterCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/40 hover:bg-destructive/10"
          onClick={onDeleteAllTranslations}
          disabled={deletingAllTranslations}
        >
          <Trash2 className="size-4" />
          {deletingAllTranslations ? "Deleting..." : "Delete translations"}
        </Button>
      )}
    </div>
  );
}
