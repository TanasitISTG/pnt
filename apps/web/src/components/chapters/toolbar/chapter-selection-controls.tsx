import { useForm } from "@tanstack/react-form";
import { Play, RotateCw, Square, X } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

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
  onSelectRange: (from: number, to: number) => void;
}

const RANGE_ERROR = "Enter a valid range (from ≥ 1, from ≤ to)";
const chapterRangeSchema = z
  .object({
    from: z.string(),
    to: z.string(),
  })
  .superRefine((value, context) => {
    const from = Number(value.from);
    const to = Number(value.to);
    const fromValid = Number.isSafeInteger(from) && from >= 1;
    const toValid = Number.isSafeInteger(to) && to >= 1;
    if (!fromValid) {
      context.addIssue({ code: "custom", message: RANGE_ERROR, path: ["from"] });
    }
    if (!toValid || (fromValid && to < from)) {
      context.addIssue({ code: "custom", message: RANGE_ERROR, path: ["to"] });
    }
  })
  .transform((value) => ({ from: Number(value.from), to: Number(value.to) }));

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
  onSelectRange,
}: ChapterSelectionControlsProps) {
  const form = useForm({
    defaultValues: {
      from: "",
      to: "",
    },
    validators: {
      onSubmit: chapterRangeSchema,
    },
    onSubmit: ({ value }) => {
      const range = chapterRangeSchema.parse(value);
      onSelectRange(range.from, range.to);
    },
  });

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
            {batchStarting ? <Spinner /> : <Play className="size-4" />}
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
            {batchStarting ? <Spinner /> : <RotateCw className="size-4" />}
            {`Re-translate selected (${selectedTranslatedCount})`}
          </Button>
        ) : null}
        <Button
          variant="destructive"
          size="sm"
          onClick={onRequestBatchStop}
          disabled={selectedActiveCount === 0 || batchPending}
        >
          {batchStopping ? <Spinner /> : <Square className="size-4" />}
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
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <form.Field name="from">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={invalid || undefined} className="w-24 gap-1">
              <FieldLabel htmlFor="chapter-range-from" variant="mutedCaption">
                From chapter
              </FieldLabel>
              <Input
                id="chapter-range-from"
                name={field.name}
                type="number"
                min="1"
                variant="compact"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={invalid}
                aria-describedby={invalid ? "chapter-range-from-error" : undefined}
              />
              {invalid && (
                <FieldError id="chapter-range-from-error" errors={field.state.meta.errors} />
              )}
            </Field>
          );
        }}
      </form.Field>
      <form.Field name="to">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={invalid || undefined} className="w-24 gap-1">
              <FieldLabel htmlFor="chapter-range-to" variant="mutedCaption">
                To chapter
              </FieldLabel>
              <Input
                id="chapter-range-to"
                name={field.name}
                type="number"
                min="1"
                variant="compact"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={invalid}
                aria-describedby={invalid ? "chapter-range-to-error" : undefined}
              />
              {invalid && (
                <FieldError id="chapter-range-to-error" errors={field.state.meta.errors} />
              )}
            </Field>
          );
        }}
      </form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button variant="outline" size="sm" type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner />}
            Select range
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
