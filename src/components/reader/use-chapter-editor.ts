import { useBlocker } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { updateChapter } from "@/lib/content/chapter.functions";
import { editChapterSchema, type EditChapterInput } from "@/lib/content/novel.schemas";
import type { ChapterDraft } from "@/components/reader/chapter-editor";

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

type SourceChangePolicy = "keep" | "clear";

export function useChapterEditor({
  chapterId,
  novelId,
  chapter,
  canEdit,
  jobRunning,
}: UseChapterEditorOptions) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ChapterDraft | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [sourcePolicyDialogOpen, setSourcePolicyDialogOpen] = useState(false);
  const editing = draft !== null;

  const { mutateAsync: saveChapter, isPending: saving } = useMutation({
    mutationFn: (payload: EditChapterInput) => updateChapter({ data: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] }),
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] }),
      ]);
      setDraft(null);
      setEditErrors({});
      setSourcePolicyDialogOpen(false);
      toast.success("Chapter saved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save chapter");
    },
  });

  const sourceChanged =
    !!draft &&
    !!chapter &&
    (draft.title !== chapter.title || draft.rawContent !== chapter.rawContent);
  const isDirty =
    !!draft &&
    !!chapter &&
    (sourceChanged ||
      draft.translatedTitle !== (chapter.translatedTitle ?? "") ||
      draft.translatedContent !== (chapter.translatedContent ?? ""));

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    withResolver: true,
    enableBeforeUnload: isDirty,
  });

  const clearEditErrors = useCallback((field: string) => {
    setEditErrors((current) => ({ ...current, [field]: "" }));
  }, []);

  const beginEditing = useCallback(() => {
    if (!chapter || !canEdit || jobRunning) return;
    setDraft({
      title: chapter.title,
      translatedTitle: chapter.translatedTitle ?? "",
      rawContent: chapter.rawContent,
      translatedContent: chapter.translatedContent ?? "",
    });
    setEditErrors({});
  }, [canEdit, chapter, jobRunning]);

  const updateDraft = useCallback(
    (field: keyof ChapterDraft, value: string) => {
      setDraft((current) => (current ? { ...current, [field]: value } : current));
      clearEditErrors(field);
    },
    [clearEditErrors],
  );

  const closeEditor = useCallback(() => {
    setDraft(null);
    setEditErrors({});
    setSourcePolicyDialogOpen(false);
  }, []);

  const requestCancelEditing = useCallback(() => {
    if (!editing) return;
    if (isDirty) {
      setDiscardDialogOpen(true);
    } else {
      closeEditor();
    }
  }, [closeEditor, editing, isDirty]);

  const setSchemaErrors = useCallback((issues: Array<{ path: PropertyKey[]; message: string }>) => {
    const fieldErrors: Record<string, string> = {};
    for (const issue of issues) {
      if (issue.path[0] !== undefined) fieldErrors[String(issue.path[0])] = issue.message;
    }
    setEditErrors(fieldErrors);
  }, []);

  const buildPayload = useCallback(
    (policy?: SourceChangePolicy): EditChapterInput | null => {
      if (!draft || !chapter) return null;

      if (
        policy !== "clear" &&
        chapter.translatedContent !== null &&
        draft.translatedContent.trim().length === 0
      ) {
        setEditErrors({
          translatedContent: "Translation cannot be empty. Choose Clear Translation to remove it.",
        });
        return null;
      }

      const translatedContentChanged =
        draft.translatedContent !== (chapter.translatedContent ?? "");
      const translatedContent =
        policy === "clear" && sourceChanged
          ? { translatedContent: null }
          : translatedContentChanged && draft.translatedContent.trim().length > 0
            ? { translatedContent: draft.translatedContent }
            : {};
      const payload = {
        chapterId,
        title: draft.title,
        translatedTitle: draft.translatedTitle.trim().length ? draft.translatedTitle : null,
        rawContent: draft.rawContent,
        ...translatedContent,
        ...(sourceChanged && policy ? { sourceChangePolicy: policy } : {}),
      } satisfies EditChapterInput;
      const result = editChapterSchema.safeParse(payload);
      if (!result.success) {
        setSchemaErrors(result.error.issues);
        return null;
      }
      return result.data;
    },
    [chapter, chapterId, draft, setSchemaErrors, sourceChanged],
  );

  const persistDraft = useCallback(
    async (policy?: SourceChangePolicy) => {
      const payload = buildPayload(policy);
      if (!payload) return;
      await saveChapter(payload).catch(() => {});
    },
    [buildPayload, saveChapter],
  );

  const handleSaveRequest = useCallback(() => {
    if (!draft || !chapter) return;
    setEditErrors({});

    const fieldsResult = editChapterSchema.safeParse({
      chapterId,
      title: draft.title,
      translatedTitle: draft.translatedTitle.trim().length ? draft.translatedTitle : null,
      rawContent: draft.rawContent,
    });
    if (!fieldsResult.success) {
      setSchemaErrors(fieldsResult.error.issues);
      return;
    }

    if (sourceChanged) {
      const hasTranslation = Boolean(
        chapter.translatedTitle ||
        chapter.translatedContent ||
        draft.translatedTitle.trim() ||
        draft.translatedContent.trim(),
      );
      if (hasTranslation) {
        setSourcePolicyDialogOpen(true);
        return;
      }
      void persistDraft("clear");
      return;
    }

    void persistDraft();
  }, [chapter, chapterId, draft, persistDraft, setSchemaErrors, sourceChanged]);

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
    editErrors,
    editing,
    handleDiscardDialogChange,
    handleSaveRequest,
    keepEditing,
    persistDraft,
    requestCancelEditing,
    saving,
    setSourcePolicyDialogOpen,
    sourcePolicyDialogOpen,
    draft,
    updateDraft,
  };
}
