import type { FormEvent } from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ChapterDraft {
  title: string;
  translatedTitle: string;
  rawContent: string;
  translatedContent: string;
}

export interface ChapterEditorProps {
  draft: ChapterDraft;
  errors: Record<string, string>;
  fontSizePx: number;
  readerFontClass?: string;
  saving: boolean;
  onChange: (field: keyof ChapterDraft, value: string) => void;
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
  draft,
  errors,
  fontSizePx,
  readerFontClass,
  saving,
  onChange,
  onSave,
  onCancel,
}: ChapterEditorProps) {
  const sourceTitleInvalid = draft.title.trim().length === 0;
  const sourceContentInvalid = draft.rawContent.trim().length === 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sourceTitleInvalid && !sourceContentInvalid && !saving) onSave();
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldIds.title}>Source Title</Label>
          <Input
            id={fieldIds.title}
            value={draft.title}
            onChange={(event) => onChange("title", event.target.value)}
            aria-invalid={errors.title ? true : undefined}
            maxLength={500}
            disabled={saving}
          />
          {errors.title && <p className="text-caption text-destructive">{errors.title}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldIds.translatedTitle}>Translated Title</Label>
          <Input
            id={fieldIds.translatedTitle}
            value={draft.translatedTitle}
            onChange={(event) => onChange("translatedTitle", event.target.value)}
            aria-invalid={errors.translatedTitle ? true : undefined}
            maxLength={500}
            disabled={saving}
          />
          {errors.translatedTitle && (
            <p className="text-caption text-destructive">{errors.translatedTitle}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={fieldIds.rawContent}>Source Content</Label>
            <span className="text-caption text-muted-foreground">
              {draft.rawContent.length.toLocaleString()} characters
            </span>
          </div>
          <Textarea
            id={fieldIds.rawContent}
            value={draft.rawContent}
            onChange={(event) => onChange("rawContent", event.target.value)}
            aria-invalid={errors.rawContent ? true : undefined}
            className={cn("min-h-64 max-h-[60vh] resize-y overflow-auto", readerFontClass)}
            style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
            disabled={saving}
          />
          {errors.rawContent && (
            <p className="text-caption text-destructive">{errors.rawContent}</p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={fieldIds.translatedContent}>Translated Content</Label>
            <span className="text-caption text-muted-foreground">
              {draft.translatedContent.length.toLocaleString()} characters
            </span>
          </div>
          <Textarea
            id={fieldIds.translatedContent}
            value={draft.translatedContent}
            onChange={(event) => onChange("translatedContent", event.target.value)}
            aria-invalid={errors.translatedContent ? true : undefined}
            className={cn("min-h-64 max-h-[60vh] resize-y overflow-auto", readerFontClass)}
            style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
            disabled={saving}
          />
          {errors.translatedContent && (
            <p className="text-caption text-destructive">{errors.translatedContent}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          <X className="size-4" />
          Cancel
        </Button>
        <Button type="submit" disabled={saving || sourceTitleInvalid || sourceContentInvalid}>
          <Check className="size-4" />
          {saving ? "Saving..." : "Save Chapter"}
        </Button>
      </div>
    </form>
  );
}
