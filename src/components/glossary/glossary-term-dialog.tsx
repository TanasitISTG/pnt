import { useEffect, type ReactNode } from "react";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft, Check } from "lucide-react";
import { useTranslations } from "use-intl";
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
  GLOSSARY_TERM_NOTE_MAX_LENGTH,
  GLOSSARY_TERM_TEXT_MAX_LENGTH,
  termCategorySchema,
  type TermCategory,
} from "@/lib/glossary/schemas";
import { encodeMessage } from "@/lib/i18n/message-code";

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

// The dialog's own copy of the two rules that carry words (i18n.md §3): the shared schema still
// guards the same input on the server, and these bounds mirror it.
const glossaryTermFormSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1, encodeMessage("validation.glossarySourceRequired"))
    .max(GLOSSARY_TERM_TEXT_MAX_LENGTH),
  target: z
    .string()
    .trim()
    .min(1, encodeMessage("validation.glossaryTargetRequired"))
    .max(GLOSSARY_TERM_TEXT_MAX_LENGTH),
  category: termCategorySchema,
  note: z.string().max(GLOSSARY_TERM_NOTE_MAX_LENGTH),
});

/** The span `studio.glossaryReplaceBody` wraps the old target in, at module scope for stability. */
const RENDER_OLD_TARGET = (chunks: ReactNode) => (
  <span className="font-medium text-foreground">{chunks}</span>
);

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
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
        <p className="font-medium text-foreground">{t("glossaryReplaceTitle")}</p>
        <p className="mt-2 text-muted-foreground">
          {t.rich("glossaryReplaceBody", {
            target: originalTarget,
            chapters: replacement.chapterCount,
            occurrences: replacement.occurrences,
            b: RENDER_OLD_TARGET,
          })}
        </p>
      </div>
      <p className="text-caption text-muted-foreground">{t("glossaryReplaceWarning")}</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={savingEdit}>
          <ArrowLeft className="size-4" />
          {tCommon("back")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onConfirm(false)}
          disabled={savingEdit}
        >
          {t("glossarySaveOnly")}
        </Button>
        <Button type="button" onClick={() => onConfirm(true)} disabled={savingEdit}>
          {savingEdit && <Spinner />}
          {savingEdit ? tCommon("saving") : t("glossaryReplaceAndSave")}
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
  const t = useTranslations("studio");
  const tCommon = useTranslations("common");
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
  const title = descriptor.mode === "edit" ? t("glossaryEditTitle") : t("glossaryAddTitle");
  const description = descriptor.mode === "edit" ? t("glossaryEditLead") : t("glossaryAddLead");
  const categoryItems = {
    character: t("termCategoryCharacter"),
    place: t("termCategoryPlace"),
    skill: t("termCategorySkill"),
    item: t("termCategoryItem"),
    other: t("termCategoryOther"),
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
              aria-label={t("glossaryCloseDialog")}
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
                    <FieldLabel htmlFor="glossary-source">{t("glossarySourceLabel")}</FieldLabel>
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
                    <FieldLabel htmlFor="glossary-target">{t("glossaryTargetLabel")}</FieldLabel>
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
                    <FieldLabel htmlFor="glossary-category">
                      {t("glossaryCategoryLabel")}
                    </FieldLabel>
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
                          {Object.entries(categoryItems).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
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
                    <FieldLabel htmlFor="glossary-note">{t("glossaryNoteLabel")}</FieldLabel>
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
                    <FieldDescription id={hintId}>{t("glossaryNoteHint")}</FieldDescription>
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
                      {tCommon("cancel")}
                    </Button>
                    <Button type="submit" disabled={pending || isSubmitting}>
                      {pending || isSubmitting ? <Spinner /> : <Check className="size-4" />}
                      {descriptor.mode === "add"
                        ? pending || isSubmitting
                          ? t("glossaryAdding")
                          : t("glossaryAddTerm")
                        : previewingReplace
                          ? t("glossaryCheckingChapters")
                          : pending || isSubmitting
                            ? tCommon("saving")
                            : t("glossarySaveTerm")}
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
