import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { updateChapter } from "@/lib/content/chapter.functions";
import { editChapterSchema, type EditChapterInput } from "@/lib/content/novel.schemas";
import type { ChapterRow } from "@/components/chapters/types";

export interface TitleEditState {
  chapterId: string;
  translatedTitle: string;
  initialTranslatedTitle: string;
}

function normalizeTitle(value: string | null): string {
  return value?.trim() ?? "";
}

export function useChapterTitleEdit(novelId: string) {
  const queryClient = useQueryClient();
  const [editState, setEditState] = useState<TitleEditState | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const { mutateAsync: saveTitle, isPending: savingTitle } = useMutation({
    mutationFn: (vars: EditChapterInput) => updateChapter({ data: vars }),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["chapter", variables.chapterId] }),
      ]);
      toast.success("Translated title updated");
      setEditState(null);
      setEditErrors({});
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update translated title");
    },
  });

  const handleStartEdit = useCallback((chapter: ChapterRow) => {
    const translatedTitle = normalizeTitle(chapter.translatedTitle);
    setEditState({
      chapterId: chapter.id,
      translatedTitle,
      initialTranslatedTitle: translatedTitle,
    });
    setEditErrors({});
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editState) return;
    setEditErrors({});

    const payload = {
      chapterId: editState.chapterId,
      translatedTitle: normalizeTitle(editState.translatedTitle) || null,
    } satisfies EditChapterInput;
    const result = editChapterSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        if (issue.path[0] !== undefined) fieldErrors[String(issue.path[0])] = issue.message;
      }
      setEditErrors(fieldErrors);
      return;
    }

    await saveTitle(payload).catch(() => {});
  }, [editState, saveTitle]);

  const handleTitleChange = useCallback((translatedTitle: string) => {
    setEditState((current) => (current ? { ...current, translatedTitle } : current));
    setEditErrors((current) => ({ ...current, translatedTitle: "" }));
  }, []);

  return {
    editState,
    setEditState,
    editErrors,
    savingTitle,
    handleStartEdit,
    handleSaveEdit,
    handleTitleChange,
  };
}
