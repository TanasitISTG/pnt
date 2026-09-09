import { Loader2, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ChapterSelectionControlsProps {
  selectedCount: number;
  hiddenSelectedCount: number;
  selectableCount: number;
  batchStarting: boolean;
  onBatchTranslate: () => void;
  onClearSelection: () => void;
  batchRangeFrom: string;
  batchRangeTo: string;
  onBatchRangeFromChange: (value: string) => void;
  onBatchRangeToChange: (value: string) => void;
  onSelectRange: () => void;
}

export function ChapterSelectionControls({
  selectedCount,
  hiddenSelectedCount,
  selectableCount,
  batchStarting,
  onBatchTranslate,
  onClearSelection,
  batchRangeFrom,
  batchRangeTo,
  onBatchRangeFromChange,
  onBatchRangeToChange,
  onSelectRange,
}: ChapterSelectionControlsProps) {
  if (selectedCount > 0) {
    return (
      <>
        <span className="self-center text-caption text-muted-foreground">
          {selectedCount}/{selectableCount} selected
          {hiddenSelectedCount > 0 ? ` · ${hiddenSelectedCount} hidden by search` : ""}
        </span>
        <Button size="sm" onClick={onBatchTranslate} disabled={batchStarting}>
          {batchStarting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {batchStarting ? "Queueing…" : "Translate selected"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          <X className="size-4" />
          Clear selection
        </Button>
      </>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-col gap-1 text-caption text-muted-foreground">
        <span>From chapter</span>
        <Input
          id="chapter-range-from"
          type="number"
          min="1"
          className="h-8 w-24 text-xs"
          value={batchRangeFrom}
          onChange={(event) => onBatchRangeFromChange(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-caption text-muted-foreground">
        <span>To chapter</span>
        <Input
          id="chapter-range-to"
          type="number"
          min="1"
          className="h-8 w-24 text-xs"
          value={batchRangeTo}
          onChange={(event) => onBatchRangeToChange(event.target.value)}
        />
      </label>
      <Button variant="outline" size="sm" onClick={onSelectRange}>
        Select range
      </Button>
    </div>
  );
}
