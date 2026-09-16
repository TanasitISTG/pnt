import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { createChapter } from "@/lib/content/chapter.functions";
import { createChapterSchema, type CreateChapterInput } from "@/lib/content/novel.schemas";

export interface FetchedChapterDraft {
  number: string;
  title: string;
  content: string;
  sourceUrl: string;
}

const manualChapterFormSchema = z.object({
  number: z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
    message: "Chapter number must be positive",
  }),
  title: z.string().min(1, "Title is required").max(500),
  rawContent: z.string().min(1, "Content is required"),
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
  sourceUrl: string | null;
  submitError: string | null;
  numberRef: RefObject<HTMLInputElement | null>;
  titleRef: RefObject<HTMLInputElement | null>;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  acceptFetchedChapter: (chapter: FetchedChapterDraft) => void;
  resetManualDraft: () => void;
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
  const autoNextNumber = useMemo(() => {
    if (chapters.length === 0) return 1;
    const maxNumber = Math.max(...chapters.map((chapter) => Number(chapter.number || 0)), 0);
    return Math.floor(maxNumber) + 1;
  }, [chapters]);
  const numberEditedRef = useRef(false);
  const [minimumNextNumber, setMinimumNextNumber] = useState(0);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { mutateAsync } = useMutation({
    mutationFn: (input: CreateChapterInput) => createChapter({ data: input }),
  });
  const nextNumber = Math.max(autoNextNumber, minimumNextNumber);
  const initialValuesRef = useRef<ManualChapterFormValues>({
    number: String(nextNumber),
    title: "",
    rawContent: "",
  });

  const form = useForm({
    defaultValues: initialValuesRef.current,
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
      const input = createChapterSchema.parse({
        novelId,
        number: Number(parsed.number),
        title: parsed.title,
        rawContent: parsed.rawContent,
      });

      try {
        await mutateAsync(input);
        invalidateChapters();
        const minimum = Math.floor(input.number) + 1;
        setMinimumNextNumber(minimum);
        numberEditedRef.current = false;
        setSourceUrl(null);
        form.reset(
          {
            number: String(Math.max(autoNextNumber, minimum)),
            title: "",
            rawContent: "",
          },
          { keepDefaultValues: true },
        );
        toast.success("Chapter added successfully");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to add chapter";
        setSubmitError(message);
        toast.error(message);
      }
    },
  });

  useEffect(() => {
    if (numberEditedRef.current) return;
    form.setFieldValue("number", String(nextNumber), { dontUpdateMeta: true });
  }, [form, nextNumber]);

  const acceptFetchedChapter = useCallback(
    (chapter: FetchedChapterDraft) => {
      numberEditedRef.current = true;
      setSourceUrl(chapter.sourceUrl);
      setSubmitError(null);
      form.reset(
        {
          number: chapter.number,
          title: chapter.title,
          rawContent: chapter.content,
        },
        { keepDefaultValues: true },
      );
    },
    [form],
  );

  const resetManualDraft = useCallback(() => {
    numberEditedRef.current = false;
    setSourceUrl(null);
    setSubmitError(null);
    form.reset(
      { number: String(nextNumber), title: "", rawContent: "" },
      { keepDefaultValues: true },
    );
  }, [form, nextNumber]);

  return {
    form,
    sourceUrl,
    submitError,
    numberRef,
    titleRef,
    contentRef,
    acceptFetchedChapter,
    resetManualDraft,
    markNumberEdited: () => {
      numberEditedRef.current = true;
    },
    clearSubmitError: () => setSubmitError(null),
  };
}

export function ManualChapterEditor({ controller }: { controller: ManualChapterEditorController }) {
  const {
    form,
    sourceUrl,
    submitError,
    numberRef,
    titleRef,
    contentRef,
    resetManualDraft,
    markNumberEdited,
    clearSubmitError,
  } = controller;
  const [canSubmit, isSubmitting] = useStore(
    form.store,
    (state) => [state.canSubmit, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-tight text-foreground">Create one chapter</h3>
        <p className="text-sm text-muted-foreground">
          Paste source text, review the details, then add it to the novel.
        </p>
      </header>

      {sourceUrl ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="min-w-0 text-foreground">
            <span className="font-semibold">Fetched from URL.</span>{" "}
            <span className="text-muted-foreground">
              Review the draft before adding it. Source:{" "}
              <span title={sourceUrl}>{truncateUrl(sourceUrl)}</span>
            </span>
          </p>
          <Button type="button" variant="outline" size="sm" onClick={resetManualDraft}>
            Start fresh
          </Button>
        </div>
      ) : null}

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
                    <FieldLabel htmlFor="chapNumber">Chapter number *</FieldLabel>
                    <Input
                      ref={numberRef}
                      id="chapNumber"
                      name={field.name}
                      type="number"
                      step="0.01"
                      min="0.01"
                      autoComplete="off"
                      placeholder="e.g. 1"
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
                    <FieldLabel htmlFor="chapTitle">Chapter title *</FieldLabel>
                    <Input
                      ref={titleRef}
                      id="chapTitle"
                      name={field.name}
                      autoComplete="off"
                      placeholder="e.g. The Awakening"
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
                    <FieldLabel htmlFor="chapContent">Source text *</FieldLabel>
                    <span className="text-sm text-muted-foreground">
                      {field.state.value.length.toLocaleString()} characters
                    </span>
                  </div>
                  <Textarea
                    ref={contentRef}
                    id="chapContent"
                    name={field.name}
                    autoComplete="off"
                    placeholder="Paste raw chapter text here..."
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
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {submitError}
          </div>
        ) : null}

        <footer className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-end">
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting && <Spinner />}
            {isSubmitting ? "Adding chapter…" : "Add chapter"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function truncateUrl(url: string): string {
  return url.length > 64 ? `${url.slice(0, 61)}…` : url;
}
