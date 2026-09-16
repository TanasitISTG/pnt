import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useForm,
  useStore,
  type FormAsyncValidateOrFn,
  type FormValidateOrFn,
  type ReactFormExtendedApi,
} from "@tanstack/react-form";
import { useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { updateChapter } from "@/lib/content/chapter/chapter.functions";
import { editChapterSchema, type EditChapterInput } from "@/lib/content/novel/novel.schemas";

interface EditableChapter {
  id: string;
  title: string;
  translatedTitle: string | null;
  rawContent: string;
  translatedContent: string | null;
}

interface UseChapterEditorOptions {
  chapterId: string;
  novelId: string;
  chapter: EditableChapter | null | undefined;
  canEdit: boolean;
  jobRunning: boolean;
}

export interface ChapterEditorFormValues {
  title: string;
  translatedTitle: string;
  rawContent: string;
  translatedContent: string;
  sourceChangePolicy: "keep" | "clear" | null;
}

type ChapterEditorValidator = FormValidateOrFn<ChapterEditorFormValues> | undefined;
type ChapterEditorAsyncValidator = FormAsyncValidateOrFn<ChapterEditorFormValues> | undefined;
type ChapterEditorSchema = z.ZodType<ChapterEditorFormValues, ChapterEditorFormValues>;
export type ChapterEditorFormApi = ReactFormExtendedApi<
  ChapterEditorFormValues,
  ChapterEditorValidator,
  ChapterEditorValidator,
  ChapterEditorAsyncValidator,
  ChapterEditorValidator,
  ChapterEditorAsyncValidator,
  ChapterEditorSchema,
  ChapterEditorAsyncValidator,
  ChapterEditorValidator,
  ChapterEditorAsyncValidator,
  ChapterEditorAsyncValidator,
  unknown
>;

const emptyChapterEditorValues: ChapterEditorFormValues = {
  title: "",
  translatedTitle: "",
  rawContent: "",
  translatedContent: "",
  sourceChangePolicy: null,
};

function createChapterEditorSchema(
  chapter: EditableChapter | null | undefined,
): ChapterEditorSchema {
  return z
    .object({
      title: z
        .string()
        .max(500)
        .refine((value) => value.trim().length > 0, "Source title is required"),
      translatedTitle: z.string().max(500),
      rawContent: z
        .string()
        .refine((value) => value.trim().length > 0, "Source content is required"),
      translatedContent: z.string(),
      sourceChangePolicy: z.enum(["keep", "clear"]).nullable(),
    })
    .superRefine((value, context) => {
      if (
        value.sourceChangePolicy !== "clear" &&
        typeof chapter?.translatedContent === "string" &&
        value.translatedContent.trim().length === 0
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Translation cannot be empty. Restore it, or change the source text and choose Clear Translation.",
          path: ["translatedContent"],
        });
      }
    });
}

export function useChapterEditor({
  chapterId,
  novelId,
  chapter,
  canEdit,
  jobRunning,
}: UseChapterEditorOptions) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [sourcePolicyDialogOpen, setSourcePolicyDialogOpen] = useState(false);
  const schema = createChapterEditorSchema(chapter);
  const { mutateAsync: saveChapter } = useMutation({
    mutationFn: (payload: EditChapterInput) => updateChapter({ data: payload }),
  });

  const form = useForm({
    defaultValues: emptyChapterEditorValues,
    validators: {
      onSubmit: schema,
    },
    onSubmitInvalid: ({ formApi, value }) => {
      const result = schema.safeParse(value);
      const invalidNames = result.success
        ? []
        : result.error.issues
            .map((issue) => issue.path[0])
            .filter(
              (name): name is keyof ChapterEditorFormValues =>
                name === "title" ||
                name === "translatedTitle" ||
                name === "rawContent" ||
                name === "translatedContent",
            );
      for (const name of invalidNames) {
        formApi.setFieldMeta(name, (previous) => ({ ...previous, isTouched: true }));
      }
      const firstInvalid = invalidNames[0];
      if (firstInvalid && typeof document !== "undefined") {
        document.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
      }
    },
    onSubmit: async ({ value }) => {
      if (!editing || !chapter) return;
      const parsed = schema.parse(value);
      const sourceChanged =
        parsed.title !== chapter.title || parsed.rawContent !== chapter.rawContent;
      if (sourceChanged && parsed.sourceChangePolicy === null) {
        const hasTranslation = Boolean(
          chapter.translatedTitle ||
          chapter.translatedContent ||
          parsed.translatedTitle.trim() ||
          parsed.translatedContent.trim(),
        );
        if (hasTranslation) {
          setSourcePolicyDialogOpen(true);
          return;
        }
      }

      const sourceChangePolicy = sourceChanged ? (parsed.sourceChangePolicy ?? "clear") : undefined;
      const translatedContentChanged =
        parsed.translatedContent !== (chapter.translatedContent ?? "");
      const translatedContent =
        sourceChangePolicy === "clear"
          ? { translatedContent: null }
          : translatedContentChanged && parsed.translatedContent.trim().length > 0
            ? { translatedContent: parsed.translatedContent }
            : {};
      const payload = editChapterSchema.parse({
        chapterId,
        title: parsed.title,
        translatedTitle: parsed.translatedTitle.trim() ? parsed.translatedTitle : null,
        rawContent: parsed.rawContent,
        ...translatedContent,
        ...(sourceChangePolicy ? { sourceChangePolicy } : {}),
      });

      try {
        await saveChapter(payload);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] }),
          queryClient.invalidateQueries({ queryKey: ["chapters", novelId] }),
          queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] }),
          queryClient.invalidateQueries({ queryKey: ["translation-eval-report", novelId] }),
        ]);
        form.reset(parsed, { keepDefaultValues: true });
        setEditing(false);
        setSourcePolicyDialogOpen(false);
        toast.success("Chapter saved");
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : "Failed to save chapter");
      }
    },
  });

  const formDirty = useStore(form.store, (state) => state.isDirty);
  const saving = useStore(form.store, (state) => state.isSubmitting);
  const isDirty = editing && formDirty;
  // Same-chapter hash jumps (reader anchors, bookmark "Go to") keep the editor on screen,
  // so only leaving the chapter route is worth an unsaved-changes prompt.
  const shouldBlock = useCallback(
    ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) =>
      isDirty && next.pathname !== current.pathname,
    [isDirty],
  );
  const blocker = useBlocker({
    shouldBlockFn: shouldBlock,
    withResolver: true,
    enableBeforeUnload: isDirty,
  });

  const beginEditing = useCallback(() => {
    if (!chapter || !canEdit || jobRunning) return;
    form.reset(
      {
        title: chapter.title,
        translatedTitle: chapter.translatedTitle ?? "",
        rawContent: chapter.rawContent,
        translatedContent: chapter.translatedContent ?? "",
        sourceChangePolicy: null,
      },
      { keepDefaultValues: true },
    );
    setEditing(true);
  }, [canEdit, chapter, form, jobRunning]);

  const closeEditor = useCallback(() => {
    form.reset(emptyChapterEditorValues, { keepDefaultValues: true });
    setEditing(false);
    setSourcePolicyDialogOpen(false);
  }, [form]);

  const requestCancelEditing = useCallback(() => {
    if (!editing) return;
    if (isDirty) {
      setDiscardDialogOpen(true);
    } else {
      closeEditor();
    }
  }, [closeEditor, editing, isDirty]);

  const handleSaveRequest = useCallback(() => {
    if (!editing || saving) return;
    form.setFieldValue("sourceChangePolicy", null, { dontUpdateMeta: true });
    void form.handleSubmit();
  }, [editing, form, saving]);

  const submitWithPolicy = useCallback(
    (policy: "keep" | "clear") => {
      if (!editing || saving) return;
      form.setFieldValue("sourceChangePolicy", policy, { dontUpdateMeta: true });
      void form.handleSubmit();
    },
    [editing, form, saving],
  );

  const handleSourcePolicyChange = useCallback(
    (open: boolean) => {
      if (!open && saving) return;
      setSourcePolicyDialogOpen(open);
      if (!open) {
        form.setFieldValue("sourceChangePolicy", null, { dontUpdateMeta: true });
      }
    },
    [form, saving],
  );

  const handleDiscardDialogChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setDiscardDialogOpen(false);
      if (blocker.status === "blocked") blocker.reset();
    },
    [blocker],
  );

  const keepEditing = useCallback(() => {
    setDiscardDialogOpen(false);
    if (blocker.status === "blocked") blocker.reset();
  }, [blocker]);

  const discardChanges = useCallback(() => {
    const wasBlocked = blocker.status === "blocked";
    closeEditor();
    setDiscardDialogOpen(false);
    if (wasBlocked) blocker.proceed();
  }, [blocker, closeEditor]);

  return {
    beginEditing,
    blocker,
    closeEditor,
    discardChanges,
    discardDialogOpen,
    editing,
    form,
    handleDiscardDialogChange,
    handleSaveRequest,
    handleSourcePolicyChange,
    keepEditing,
    requestCancelEditing,
    saving,
    sourcePolicyDialogOpen,
    submitWithPolicy,
  };
}
