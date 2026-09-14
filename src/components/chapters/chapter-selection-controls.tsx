import { Loader2, Play, RotateCw, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ChapterSelectionControlsProps {
  selectedCount: number;
  hiddenSelectedCount: number;
  selectableCount: number;
  selectedMissingCount: number;
  selectedTranslatedCount: number;
  selectedActiveCount: number;
  batchStarting: boolean;
  batchStopping: boolean;
  onBatchTranslate: () => void;
  onRequestBatchRetranslate: () => void;
  onRequestBatchStop: () => void;
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
  selectedMissingCount,
  selectedTranslatedCount,
  selectedActiveCount,
  batchStarting,
  batchStopping,
  onBatchTranslate,
  onRequestBatchRetranslate,
  onRequestBatchStop,
  onClearSelection,
  batchRangeFrom,
  batchRangeTo,
  onBatchRangeFromChange,
  onBatchRangeToChange,
  onSelectRange,
}: ChapterSelectionControlsProps) {
  if (selectedCount > 0) {
    const batchPending = batchStarting || batchStopping;
    return (
      <>
        <span className="self-center text-caption text-muted-foreground">
          {selectedCount}/{selectableCount} selected
          {hiddenSelectedCount > 0 ? ` · ${hiddenSelectedCount} hidden by search` : ""}
        </span>
        {selectedMissingCount > 0 ? (
          <Button size="sm" onClick={onBatchTranslate} disabled={batchPending}>
            {batchStarting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            {`Translate selected (${selectedMissingCount})`}
          </Button>
        ) : null}
        {selectedTranslatedCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRequestBatchRetranslate}
            disabled={batchPending}
          >
            {batchStarting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCw className="size-4" />
            )}
            {`Re-translate selected (${selectedTranslatedCount})`}
          </Button>
        ) : null}
        <Button
          variant="destructive"
          size="sm"
          onClick={onRequestBatchStop}
          disabled={selectedActiveCount === 0 || batchPending}
        >
          {batchStopping ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Square className="size-4" />
          )}
          {`Stop selected (${selectedActiveCount})`}
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
