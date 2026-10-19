import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useForm,
  useStore,
  type FormAsyncValidateOrFn,
  type FormValidateOrFn,
  type ReactFormExtendedApi,
} from "@tanstack/react-form";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createChapter } from "@/lib/content/chapter/chapter.functions";
import type { CreateChapterInput } from "@/lib/content/novel/novel.schemas";
import { encodeMessage } from "@/lib/i18n/message-code";

// The client's own copy of the three field rules, keyed rather than worded (i18n.md §3): the
// shared schema still guards the same input on the server, and these bounds mirror it the way
// NovelForm mirrors its own.
const manualChapterFormSchema = z.object({
  number: z
    .string()
    .transform((value) => Number(value))
    .pipe(
      z
        .number()
        .positive(encodeMessage("validation.chapterNumberPositive"))
        .max(999_999.99, encodeMessage("validation.chapterNumberMax"))
        .multipleOf(0.01, encodeMessage("validation.chapterNumberDecimals")),
    ),
  title: z
    .string()
    .min(1, encodeMessage("validation.titleRequired"))
    .max(500)
    .refine(
      (value) => value.length === 0 || value.trim().length > 0,
      encodeMessage("validation.titleRequired"),
    ),
  rawContent: z
    .string()
    .min(1, encodeMessage("validation.sourceContentRequired"))
    .refine(
      (value) => value.length === 0 || value.trim().length > 0,
      encodeMessage("validation.sourceContentRequired"),
    ),
});
interface ManualChapterFormValues {
  number: string;
  title: string;
  rawContent: string;
}

type ManualChapterValidator = FormValidateOrFn<ManualChapterFormValues> | undefined;
type ManualChapterAsyncValidator = FormAsyncValidateOrFn<ManualChapterFormValues> | undefined;
type ManualChapterFormApi = ReactFormExtendedApi<
  ManualChapterFormValues,
  ManualChapterValidator,
  ManualChapterValidator,
  ManualChapterAsyncValidator,
  ManualChapterValidator,
  ManualChapterAsyncValidator,
  typeof manualChapterFormSchema,
  ManualChapterAsyncValidator,
  ManualChapterValidator,
  ManualChapterAsyncValidator,
  ManualChapterAsyncValidator,
  unknown
>;

export interface ManualChapterEditorController {
  form: ManualChapterFormApi;
  submitError: string | null;
  numberRef: RefObject<HTMLInputElement | null>;
  titleRef: RefObject<HTMLInputElement | null>;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  markNumberEdited: () => void;
  clearSubmitError: () => void;
}

export function useManualChapterEditor({
  novelId,
  chapters,
  invalidateChapters,
}: {
  novelId: string;
  chapters: Array<{ number: string }>;
  invalidateChapters: () => void;
}) {
  const t = useTranslations("studio");
  const autoNextNumber = useMemo(() => {
    if (chapters.length === 0) return 1;
    const maxNumber = Math.max(...chapters.map((chapter) => Number(chapter.number || 0)), 0);
    return Math.floor(maxNumber) + 1;
  }, [chapters]);
  const numberEditedRef = useRef(false);
  const [minimumNextNumber, setMinimumNextNumber] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { mutateAsync } = useMutation({
    mutationFn: (input: CreateChapterInput) => createChapter({ data: input }),
  });
  const nextNumber = Math.max(autoNextNumber, minimumNextNumber);
  const [initialValues] = useState<ManualChapterFormValues>(() => ({
    number: String(nextNumber),
    title: "",
    rawContent: "",
  }));

  const form = useForm({
    defaultValues: initialValues,
    validators: {
      onSubmit: manualChapterFormSchema,
    },
    onSubmitInvalid: ({ formApi, value }) => {
      const result = manualChapterFormSchema.safeParse(value);
      const invalidNames = result.success
        ? []
        : result.error.issues
            .map((issue) => issue.path[0])
            .filter(
              (name): name is keyof ManualChapterFormValues =>
                name === "number" || name === "title" || name === "rawContent",
            );
      for (const name of invalidNames) {
        formApi.setFieldMeta(name, (previous) => ({ ...previous, isTouched: true }));
      }
      const refs: Record<keyof ManualChapterFormValues, RefObject<HTMLElement | null>> = {
        number: numberRef,
        title: titleRef,
        rawContent: contentRef,
      };
      refs[invalidNames[0] ?? "number"].current?.focus();
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const parsed = manualChapterFormSchema.parse(value);
      const input: CreateChapterInput = {
        novelId,
        ...parsed,
      };

      try {
        await mutateAsync(input);
        invalidateChapters();
        const minimum = Math.floor(input.number) + 1;
        setMinimumNextNumber(minimum);
        numberEditedRef.current = false;
        form.reset(
          {
            number: String(Math.max(autoNextNumber, minimum)),
            title: "",
            rawContent: "",
          },
          { keepDefaultValues: true },
        );
        toast.success(t("chapterAdded"));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : t("chapterAddFailed");
        setSubmitError(message);
        toast.error(message);
      }
    },
  });

  useEffect(() => {
    if (numberEditedRef.current) return;
    form.setFieldValue("number", String(nextNumber), { dontUpdateMeta: true });
  }, [form, nextNumber]);

  return {
    form,
    submitError,
    numberRef,
    titleRef,
    contentRef,
    markNumberEdited: () => {
      numberEditedRef.current = true;
    },
    clearSubmitError: () => setSubmitError(null),
  };
}

export function ManualChapterEditor({ controller }: { controller: ManualChapterEditorController }) {
  const { form, submitError, numberRef, titleRef, contentRef, markNumberEdited, clearSubmitError } =
    controller;
  const t = useTranslations("studio");
  const [canSubmit, isSubmitting] = useStore(
    form.store,
    (state) => [state.canSubmit, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("manualLead")}</p>

      <form
        noValidate
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-6"
      >
        <FieldGroup>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)]">
            <form.Field name="number">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="chapNumber">{t("chapterNumberLabel")}</FieldLabel>
                    <Input
                      ref={numberRef}
                      id="chapNumber"
                      name={field.name}
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="999999.99"
                      autoComplete="off"
                      placeholder={t("chapterNumberPlaceholder")}
                      value={field.state.value}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? "chap-number-error" : undefined}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        markNumberEdited();
                        clearSubmitError();
                        field.handleChange(event.target.value);
                      }}
                    />
                    {invalid && (
                      <FieldError id="chap-number-error" errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="title">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid || undefined}>
                    <FieldLabel htmlFor="chapTitle">{t("chapterTitleLabel")}</FieldLabel>
                    <Input
                      ref={titleRef}
                      id="chapTitle"
                      name={field.name}
                      autoComplete="off"
                      placeholder={t("chapterTitlePlaceholder")}
                      value={field.state.value}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? "chap-title-error" : undefined}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        clearSubmitError();
                        field.handleChange(event.target.value);
                      }}
                      maxLength={500}
                    />
                    {invalid && (
                      <FieldError id="chap-title-error" errors={field.state.meta.errors} />
                    )}
                  </Field>
                );
              }}
            </form.Field>
          </div>

          <form.Field name="rawContent">
            {(field) => {
              const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={invalid || undefined}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <FieldLabel htmlFor="chapContent">{t("sourceTextLabel")}</FieldLabel>
                    <span className="text-sm text-muted-foreground">
                      {t("characterCount", { count: field.state.value.length })}
                    </span>
                  </div>
                  <Textarea
                    ref={contentRef}
                    id="chapContent"
                    name={field.name}
                    autoComplete="off"
                    placeholder={t("sourceTextPlaceholder")}
                    value={field.state.value}
                    aria-invalid={invalid}
                    aria-describedby={invalid ? "chap-content-error" : undefined}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      clearSubmitError();
                      field.handleChange(event.target.value);
                    }}
                    rows={14}
                  />
                  {invalid && (
                    <FieldError id="chap-content-error" errors={field.state.meta.errors} />
                  )}
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>

        {submitError ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-text"
            role="alert"
          >
            {submitError}
          </div>
        ) : null}

        <footer className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting && <Spinner />}
            {isSubmitting ? t("addingChapter") : t("addChapterButton")}
          </Button>
        </footer>
      </form>
    </div>
  );
}
