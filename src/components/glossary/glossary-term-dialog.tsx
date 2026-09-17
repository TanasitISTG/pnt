import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft, Check } from "lucide-react";
import { z } from "zod";

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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  createTermSchema,
  GLOSSARY_TERM_NOTE_MAX_LENGTH,
  GLOSSARY_TERM_TEXT_MAX_LENGTH,
  termCategorySchema,
  type TermCategory,
} from "@/lib/glossary/schemas";

export interface GlossaryTermDraft {
  source: string;
  target: string;
  category: TermCategory;
  note: string;
}

export type GlossaryTermDialogDescriptor =
  | { mode: "add"; initialValues: GlossaryTermDraft }
  | {
      mode: "edit";
      termId: string;
      originalTarget: string;
      initialValues: GlossaryTermDraft;
    };

export interface TermReplacementPreview {
  chapterCount: number;
  occurrences: number;
}

interface GlossaryTermDialogProps {
  descriptor: GlossaryTermDialogDescriptor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: GlossaryTermDraft) => Promise<void>;
  addingTerm: boolean;
  savingEdit: boolean;
  previewingReplace: boolean;
  replacement: TermReplacementPreview | null;
  onBackFromReplacement: () => void;
  onReplaceConfirm: (applyToChapters: boolean) => void;
}

const emptyDraft: GlossaryTermDraft = {
  source: "",
  target: "",
  category: "character",
  note: "",
};

const glossaryTermFormSchema = z.object({
  source: createTermSchema.shape.source,
  target: createTermSchema.shape.target,
  category: termCategorySchema,
  note: z.string().max(GLOSSARY_TERM_NOTE_MAX_LENGTH),
});

const categoryItems: Record<string, string> = {
  character: "Character",
  place: "Place",
  skill: "Skill",
  item: "Item",
  other: "Other",
};

function GlossaryReplacementStep({
  replacement,
  originalTarget,
  savingEdit,
  onBack,
  onConfirm,
}: {
  replacement: TermReplacementPreview;
  originalTarget: string;
  savingEdit: boolean;
  onBack: () => void;
  onConfirm: (applyToChapters: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
        <p className="font-medium text-foreground">Replace this target in translated chapters?</p>
        <p className="mt-2 text-muted-foreground">
          The old target <span className="font-medium text-foreground">“{originalTarget}”</span>{" "}
          appears in {replacement.chapterCount} translated chapter(s) ({replacement.occurrences}{" "}
          occurrence(s)).
        </p>
      </div>
      <p className="text-caption text-muted-foreground">
        Replacement is an exact, case-sensitive match and may also match inside longer words. This
        cannot be undone.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={savingEdit}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onConfirm(false)}
          disabled={savingEdit}
        >
          Save glossary only
        </Button>
        <Button type="button" onClick={() => onConfirm(true)} disabled={savingEdit}>
          {savingEdit && <Spinner />}
          {savingEdit ? "Saving…" : "Replace & save"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function GlossaryTermDialog({
  descriptor,
  open,
  onOpenChange,
  onSubmit,
  addingTerm,
  savingEdit,
  previewingReplace,
  replacement,
  onBackFromReplacement,
  onReplaceConfirm,
}: GlossaryTermDialogProps) {
  const form = useForm({
    defaultValues: emptyDraft,
    validators: {
      onSubmit: glossaryTermFormSchema,
    },
    onSubmitInvalid: ({ formApi, value }) => {
      const result = glossaryTermFormSchema.safeParse(value);
      if (result.success) return;
      const invalidNames = result.error.issues
        .map((issue) => issue.path[0])
        .filter(
          (name): name is keyof GlossaryTermDraft =>
            name === "source" || name === "target" || name === "category" || name === "note",
        );
      for (const name of invalidNames) {
        formApi.setFieldMeta(name, (previous) => ({ ...previous, isTouched: true }));
      }
    },
    onSubmit: async ({ value }) => {
      await onSubmit(glossaryTermFormSchema.parse(value));
    },
  });

  useEffect(() => {
    if (!open || !descriptor) return;
    form.reset(descriptor.initialValues, { keepDefaultValues: true });
  }, [descriptor, form, open]);

  if (!descriptor) return null;
  const pending = addingTerm || savingEdit || previewingReplace || form.state.isSubmitting;
  const title = descriptor.mode === "edit" ? "Edit glossary term" : "Add glossary term";
  const description =
    descriptor.mode === "edit"
      ? "Update the mapping used to keep future translations consistent."
      : "Add a source-to-target mapping for this novel's future translations.";

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

        {replacement && descriptor.mode === "edit" ? (
          <GlossaryReplacementStep
            replacement={replacement}
            originalTarget={descriptor.originalTarget}
            savingEdit={savingEdit}
            onBack={onBackFromReplacement}
            onConfirm={onReplaceConfirm}
          />
        ) : (
          <form
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="source">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = invalid ? "glossary-source-error" : undefined;
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor="glossary-source">Source term</FieldLabel>
                    <Input
                      id="glossary-source"
                      name={field.name}
                      value={field.state.value}
                      maxLength={GLOSSARY_TERM_TEXT_MAX_LENGTH}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={errorId}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="target">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = invalid ? "glossary-target-error" : undefined;
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor="glossary-target">Target translation</FieldLabel>
                    <Input
                      id="glossary-target"
                      name={field.name}
                      value={field.state.value}
                      maxLength={GLOSSARY_TERM_TEXT_MAX_LENGTH}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={errorId}
                    />
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="category">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = "glossary-category-error";
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor="glossary-category">Category</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.state.value}
                      items={categoryItems}
                      onValueChange={(value) => value && field.handleChange(value as TermCategory)}
                    >
                      <SelectTrigger
                        id="glossary-category"
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="character">Character</SelectItem>
                          <SelectItem value="place">Place</SelectItem>
                          <SelectItem value="skill">Skill</SelectItem>
                          <SelectItem value="item">Item</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="note">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const hintId = "glossary-note-hint";
                const errorId = invalid ? "glossary-note-error" : undefined;
                return (
                  <Field data-invalid={invalid || undefined} className="min-w-0">
                    <FieldLabel htmlFor="glossary-note">Note</FieldLabel>
                    <Textarea
                      id="glossary-note"
                      name={field.name}
                      value={field.state.value}
                      maxLength={GLOSSARY_TERM_NOTE_MAX_LENGTH}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                      aria-invalid={invalid}
                      aria-describedby={[hintId, errorId].filter(Boolean).join(" ")}
                      className="min-h-10"
                    />
                    <FieldDescription id={hintId}>
                      Optional context for future editing.
                    </FieldDescription>
                    {invalid && <FieldError id={errorId} errors={field.state.meta.errors} />}
                  </Field>
                );
              }}
            </form.Field>

            <DialogFooter className="sm:col-span-2">
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onOpenChange(false)}
                      disabled={pending || isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={pending || isSubmitting}>
                      {pending || isSubmitting ? <Spinner /> : <Check className="size-4" />}
                      {descriptor.mode === "add"
                        ? pending || isSubmitting
                          ? "Adding…"
                          : "Add term"
                        : previewingReplace
                          ? "Checking chapters…"
                          : pending || isSubmitting
                            ? "Saving…"
                            : "Save term"}
                    </Button>
                  </>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
