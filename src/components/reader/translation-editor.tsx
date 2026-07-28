import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { renderParagraph } from "./render-paragraph";

export interface TranslationEditorProps {
  rawParagraphs: string[];
  editValue: string;
  onEditValueChange: (value: string) => void;
  fontSizePx: number;
  readerFontClass?: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function TranslationEditor({
  rawParagraphs,
  editValue,
  onEditValueChange,
  fontSizePx,
  readerFontClass,
  saving,
  onSave,
  onCancel,
}: TranslationEditorProps) {
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = editTextareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [editValue]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <span className="text-caption font-semibold text-muted-foreground uppercase">Raw</span>
          {rawParagraphs.map((p, i) => renderParagraph(p, i, fontSizePx, readerFontClass, true))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-caption font-semibold text-muted-foreground uppercase">
            Translation
          </span>
          <Textarea
            ref={editTextareaRef}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className={cn("min-h-64 resize-none overflow-hidden", readerFontClass)}
            style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-border pt-4">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          <X className="size-4" />
          Cancel
        </Button>
        <Button onClick={onSave} disabled={saving || editValue.trim().length === 0}>
          <Check className="size-4" />
          {saving ? "Saving..." : "Save Translation"}
        </Button>
      </div>
    </div>
  );
}
