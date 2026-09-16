import { useStore } from "@tanstack/react-form";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChapterEditorFormApi } from "./use-chapter-editor";

export interface ChapterEditorProps {
  form: ChapterEditorFormApi;
  fontSizePx: number;
  readerFontClass?: string;
  onSave: () => void;
  onCancel: () => void;
}

const fieldIds = {
  title: "chapter-editor-source-title",
  translatedTitle: "chapter-editor-translated-title",
  rawContent: "chapter-editor-source-content",
  translatedContent: "chapter-editor-translated-content",
} as const;

export function ChapterEditor({
  form,
  fontSizePx,
  readerFontClass,
  onSave,
  onCancel,
}: ChapterEditorProps) {
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const [title, rawContent] = useStore(
    form.store,
    (state) => [state.values.title, state.values.rawContent] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );
  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <form.Field name="title">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor={fieldIds.title}>Source Title</FieldLabel>
                <Input
                  id={fieldIds.title}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                  maxLength={500}
                  disabled={isSubmitting}
                />
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="translatedTitle">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor={fieldIds.translatedTitle}>Translated Title</FieldLabel>
                <Input
                  id={fieldIds.translatedTitle}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                  maxLength={500}
                  disabled={isSubmitting}
                />
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <form.Field name="rawContent">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <FieldLabel htmlFor={fieldIds.rawContent}>Source Content</FieldLabel>
                  <span className="text-caption text-muted-foreground">
                    {field.state.value.length.toLocaleString()} characters
                  </span>
                </div>
                <Textarea
                  id={fieldIds.rawContent}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                  className={cn("min-h-64 max-h-[60vh] resize-y overflow-auto", readerFontClass)}
                  style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
                  disabled={isSubmitting}
                />
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="translatedContent">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <FieldLabel htmlFor={fieldIds.translatedContent}>Translated Content</FieldLabel>
                  <span className="text-caption text-muted-foreground">
                    {field.state.value.length.toLocaleString()} characters
                  </span>
                </div>
                <Textarea
                  id={fieldIds.translatedContent}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={invalid}
                  className={cn("min-h-64 max-h-[60vh] resize-y overflow-auto", readerFontClass)}
                  style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
                  disabled={isSubmitting}
                />
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>
      </div>

      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          <X className="size-4" />
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !title.trim() || !rawContent.trim()}>
          {isSubmitting ? <Spinner /> : <Check className="size-4" />}
          {isSubmitting ? "Saving…" : "Save Chapter"}
        </Button>
      </div>
    </form>
  );
}
