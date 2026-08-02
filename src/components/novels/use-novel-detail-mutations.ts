import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { deleteNovel, setNovelPublished } from "@/lib/content/novel.functions";
import {
  deleteChapter,
  setChapterPublished,
  setAllChaptersPublished,
} from "@/lib/content/chapter.functions";
import {
  deleteAllNovelTranslations,
  translateMissingTitles,
} from "@/lib/content/chapter-ops.functions";

export function useNovelDetailMutations(novelId: string, onTranslationsDeleted: () => void) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null);

  const { mutateAsync: removeNovel, isPending: deletingNovel } = useMutation({
    mutationFn: () => deleteNovel({ data: { novelId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Novel deleted successfully");
      navigate({ to: "/" });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete novel");
    },
  });

  const { mutate: publishNovel, isPending: publishingNovel } = useMutation({
    mutationFn: (publishedAt: Date | null) => setNovelPublished({ data: { novelId, publishedAt } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novel", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Novel publish state updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update novel publish state");
    },
  });

  const { mutateAsync: removeChapter, isPending: deletingChapter } = useMutation({
    mutationFn: (vars: { chapterId: string }) => deleteChapter({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Chapter deleted successfully");
      setDeleteChapterId(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete chapter");
    },
  });

  const { mutate: publishChapter, isPending: publishingChapter } = useMutation({
    mutationFn: (vars: { chapterId: string; publishedAt: Date | null }) =>
      setChapterPublished({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success("Publish state updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update publish state");
    },
  });

  const { mutate: publishAllChapters, isPending: publishingAll } = useMutation({
    mutationFn: () => setAllChaptersPublished({ data: { novelId, publishedAt: new Date() } }),
    onSuccess: ({ count }) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success(`Published ${count} chapter${count === 1 ? "" : "s"}`);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to publish all chapters");
    },
  });

  const { mutate: backfillTitles, isPending: backfillingTitles } = useMutation({
    mutationFn: () => translateMissingTitles({ data: { novelId } }),
    onSuccess: ({ translated }) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success(
        translated > 0 ? `Translated ${translated} chapter title(s)` : "No titles translated",
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to translate titles");
    },
  });

  const { mutate: deleteAllTranslations, isPending: deletingAllTranslations } = useMutation({
    mutationFn: () => deleteAllNovelTranslations({ data: { novelId } }),
    onSuccess: ({ chaptersCleared }) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novel", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      queryClient.invalidateQueries({ queryKey: ["residualHanzi", novelId] });
      onTranslationsDeleted();
      toast.success(
        chaptersCleared > 0
          ? `Deleted translations from ${chaptersCleared} chapter(s)`
          : "No translations to delete",
      );
    },
    onError: () => {
      toast.error("Failed to delete translations");
    },
  });

  return {
    removeNovel,
    deletingNovel,
    publishNovel,
    publishingNovel,
    removeChapter,
    deletingChapter,
    deleteChapterId,
    setDeleteChapterId,
    publishChapter,
    publishingChapter,
    publishAllChapters,
    publishingAll,
    backfillTitles,
    backfillingTitles,
    deleteAllTranslations,
    deletingAllTranslations,
  };
}
