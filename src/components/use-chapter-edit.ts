import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getChapter, updateChapterRaw } from "@/lib/chapter.functions";
import { updateChapterSchema, type UpdateChapterInput } from "@/lib/novel.schemas";
import type { ChapterRow } from "@/components/chapter-table";

export interface EditState {
  chapterId: string;
  number: string;
  title: string;
  rawContent: string;
  contentLoading: boolean;
}

export function useChapterEdit(novelId: string) {
  const queryClient = useQueryClient();
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const { mutateAsync: saveChapterEdit, isPending: savingEdit } = useMutation({
    mutationFn: (vars: UpdateChapterInput) => updateChapterRaw({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success("Chapter updated");
      setEditState(null);
      setEditErrors({});
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update chapter");
    },
  });

  const handleStartEdit = async (chapter: ChapterRow) => {
    setEditState({
      chapterId: chapter.id,
      number: String(Number(chapter.number)),
      title: chapter.title,
      rawContent: "",
      contentLoading: true,
    });
    setEditErrors({});

    try {
      const full = await getChapter({ data: { chapterId: chapter.id } });
      setEditState((s) =>
        s?.chapterId === chapter.id
          ? { ...s, rawContent: full?.rawContent ?? "", contentLoading: false }
          : s,
      );
    } catch {
      setEditState((s) => (s?.chapterId === chapter.id ? { ...s, contentLoading: false } : s));
      toast.error("Failed to load chapter content");
    }
  };

  const handleSaveEdit = async () => {
    setEditErrors({});
    if (!editState) return;

    const payload = {
      chapterId: editState.chapterId,
      number: Number(editState.number),
      title: editState.title,
      rawContent: editState.rawContent,
    };

    const result = updateChapterSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
      });
      setEditErrors(fieldErrors);
      return;
    }

    await saveChapterEdit(payload);
  };

  return {
    editState,
    setEditState,
    editErrors,
    setEditErrors,
    savingEdit,
    handleStartEdit,
    handleSaveEdit,
  };
}
