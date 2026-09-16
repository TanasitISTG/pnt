import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ChapterRow } from "@/components/chapters/types";
import { updateChapter } from "@/lib/content/chapter.functions";
import { editChapterSchema, type EditChapterInput } from "@/lib/content/novel.schemas";

export interface TitleEditState {
  chapterId: string;
  initialTranslatedTitle: string;
}

export function useChapterTitleEdit(novelId: string) {
  const queryClient = useQueryClient();
  const [editState, setEditState] = useState<TitleEditState | null>(null);
  const { mutateAsync: saveTitle } = useMutation({
    mutationFn: (variables: EditChapterInput) => updateChapter({ data: variables }),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["chapter", variables.chapterId] }),
      ]);
      toast.success("Translated title updated");
      setEditState(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update translated title");
    },
  });

  const handleStartEdit = useCallback((chapter: ChapterRow) => {
    setEditState({
      chapterId: chapter.id,
      initialTranslatedTitle: chapter.translatedTitle?.trim() ?? "",
    });
  }, []);

  const handleSaveTitle = useCallback(
    async (value: string) => {
      if (!editState) return;
      const payload = editChapterSchema.parse({
        chapterId: editState.chapterId,
        translatedTitle: value.trim() || null,
      });
      await saveTitle(payload).catch(() => {});
    },
    [editState, saveTitle],
  );

  return {
    editState,
    setEditState,
    handleStartEdit,
    handleSaveTitle,
  };
}
