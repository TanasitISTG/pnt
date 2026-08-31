import { ArrowLeft, Check, Loader2 } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TermCategory } from "@/lib/glossary/schemas";

export interface GlossaryTermDraft {
  source: string;
  target: string;
  category: TermCategory;
  note: string;
}

export interface GlossaryEditState extends GlossaryTermDraft {
  termId: string;
  originalTarget: string;
}

export interface TermReplacementPreview {
  chapterCount: number;
  occurrences: number;
}

interface GlossaryTermDialogProps {
  mode: "add" | "edit" | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addDraft: GlossaryTermDraft;
  onAddDraftChange: (draft: GlossaryTermDraft) => void;
  editState: GlossaryEditState | null;
  onEditStateChange: (state: GlossaryEditState) => void;
  errors: Record<string, string>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  addingTerm: boolean;
  savingEdit: boolean;
  previewingReplace: boolean;
  replacement: TermReplacementPreview | null;
  onBackFromReplacement: () => void;
  onReplaceConfirm: (applyToChapters: boolean) => void;
}

const categoryItems: Record<string, string> = {
  character: "Character",
  place: "Place",
  skill: "Skill",
  item: "Item",
  other: "Other",
};

export function GlossaryTermDialog({
  mode,
  open,
  onOpenChange,
  addDraft,
  onAddDraftChange,
  editState,
  onEditStateChange,
  errors,
  onSubmit,
  addingTerm,
  savingEdit,
  previewingReplace,
  replacement,
  onBackFromReplacement,
  onReplaceConfirm,
}: GlossaryTermDialogProps) {
  const pending = addingTerm || savingEdit || previewingReplace;
  const draft = mode === "edit" ? editState : addDraft;
  if (!mode || !draft) return null;

  const title = mode === "edit" ? "Edit glossary term" : "Add glossary term";
  const description =
    mode === "edit"
      ? "Update the mapping used to keep future translations consistent."
      : "Add a source-to-target mapping for this novel's future translations.";
  const updateDraft = (changes: Partial<GlossaryTermDraft>) => {
    if (mode === "edit" && editState) {
      onEditStateChange({ ...editState, ...changes });
    } else {
      onAddDraftChange({ ...addDraft, ...changes });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              aria-label="Close glossary term dialog"
              disabled={pending}
            />
          }
        >
          <span aria-hidden="true">×</span>
        </DialogClose>

        {replacement && mode === "edit" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium text-foreground">
                Replace this target in translated chapters?
              </p>
              <p className="mt-2 text-muted-foreground">
                The old target{" "}
                <span className="font-medium text-foreground">“{editState?.originalTarget}”</span>{" "}
                appears in {replacement.chapterCount} translated chapter(s) (
                {replacement.occurrences} occurrence(s)).
              </p>
            </div>
            <p className="text-caption text-muted-foreground">
              Replacement is an exact, case-sensitive match and may also match inside longer words.
              This cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onBackFromReplacement} disabled={savingEdit}>
                <ArrowLeft className="size-4" />
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => onReplaceConfirm(false)}
                disabled={savingEdit}
              >
                Save glossary only
              </Button>
              <Button onClick={() => onReplaceConfirm(true)} disabled={savingEdit}>
                {savingEdit && (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                )}
                {savingEdit ? "Saving…" : "Replace & save"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
            <FormField id="glossary-source" label="Source term" error={errors.source}>
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={draft.source}
                  maxLength={500}
                  onChange={(event) => updateDraft({ source: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="glossary-target" label="Target translation" error={errors.target}>
              {({ id, ...fieldProps }) => (
                <Input
                  {...fieldProps}
                  id={id}
                  value={draft.target}
                  maxLength={500}
                  onChange={(event) => updateDraft({ target: event.target.value })}
                />
              )}
            </FormField>
            <FormField id="glossary-category" label="Category" error={errors.category}>
              {({ id, ...fieldProps }) => (
                <Select
                  value={draft.category}
                  items={categoryItems}
                  onValueChange={(value) =>
                    value && updateDraft({ category: value as TermCategory })
                  }
                >
                  <SelectTrigger {...fieldProps} id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="character">Character</SelectItem>
                    <SelectItem value="place">Place</SelectItem>
                    <SelectItem value="skill">Skill</SelectItem>
                    <SelectItem value="item">Item</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <FormField
              id="glossary-note"
              label="Note"
              hint="Optional context for future editing."
              error={errors.note}
            >
              {({ id, ...fieldProps }) => (
                <Textarea
                  {...fieldProps}
                  id={id}
                  value={draft.note}
                  maxLength={1000}
                  onChange={(event) => updateDraft({ note: event.target.value })}
                  className="min-h-10"
                />
              )}
            </FormField>
            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
                {!pending && <Check className="size-4" />}
                {mode === "edit"
                  ? previewingReplace
                    ? "Checking chapters…"
                    : savingEdit
                      ? "Saving…"
                      : "Save term"
                  : addingTerm
                    ? "Adding…"
                    : "Add term"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid": boolean;
};

function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter((value): value is string => Boolean(value)).join(" ") || undefined;
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error),
      })}
      {hint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
