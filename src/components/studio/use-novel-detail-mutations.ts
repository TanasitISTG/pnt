import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { deleteNovel, setNovelPublished } from "@/lib/content/novel/novel.functions";
import {
  deleteChapter,
  reorderChapters,
  setChapterPublished,
  setAllChaptersPublished,
} from "@/lib/content/chapter/chapter.functions";
import {
  deleteAllNovelTranslations,
  translateMissingTitles,
} from "@/lib/content/chapter/chapter-ops.functions";
import { invalidateNovelChapterDetails } from "@/lib/content/chapter/chapter.query";
import { translateServerError } from "@/lib/i18n/server-error";

type ChapterPublishInput = {
  chapterId: string;
  publishedAt: Date | null;
};

export function useNovelDetailMutations(novelId: string, onTranslationsDeleted: () => void) {
  const t = useTranslations("studio");
  // A failure from the server is a code, and the codec is what turns it into the reader's words;
  // anything else keeps its own message.
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null);
  const publishChapterInFlightRef = useRef(false);

  const { mutateAsync: removeNovel, isPending: deletingNovel } = useMutation({
    mutationFn: () => deleteNovel({ data: { novelId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success(t("novelDeleted"));
      navigate({ to: "/" });
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("novelDeleteFailed")));
    },
  });

  const { mutate: publishNovel, isPending: publishingNovel } = useMutation({
    mutationFn: (publishedAt: Date | null) => setNovelPublished({ data: { novelId, publishedAt } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novel", novelId] });
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success(t("novelPublishStateUpdated"));
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("novelPublishStateFailed")));
    },
  });

  const { mutateAsync: removeChapter, isPending: deletingChapter } = useMutation({
    mutationFn: (vars: { chapterId: string }) => deleteChapter({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
      queryClient.invalidateQueries({ queryKey: ["adminNovelDetailMetrics", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success(t("chapterDeleted"));
      setDeleteChapterId(null);
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("chapterDeleteFailed")));
    },
  });

  const {
    mutate: runPublishChapter,
    isPending: publishChapterPending,
    variables: publishChapterVariables,
  } = useMutation({
    mutationFn: (vars: ChapterPublishInput) => setChapterPublished({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
      toast.success(t("chapterPublishStateUpdated"));
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("chapterPublishStateFailed")));
    },
    onSettled: () => {
      publishChapterInFlightRef.current = false;
    },
  });
  const publishChapter = useCallback(
    (vars: ChapterPublishInput) => {
      if (publishChapterInFlightRef.current) {
        toast.info(t("publishInFlight"));
        return;
      }
      publishChapterInFlightRef.current = true;
      runPublishChapter(vars);
    },
    [runPublishChapter, t],
  );
  const publishingChapterId = publishChapterPending
    ? (publishChapterVariables?.chapterId ?? null)
    : null;

  const { mutate: publishAllChapters, isPending: publishingAll } = useMutation({
    mutationFn: () => setAllChaptersPublished({ data: { novelId, publishedAt: new Date() } }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
      // The readiness read is what marks a refused chapter, so it is refreshed with the rows
      // the refusal changed.
      queryClient.invalidateQueries({ queryKey: ["publicationReadiness", novelId] });
      if ("unpublished" in result) {
        toast.success(t("chaptersUnpublished", { count: result.unpublished }));
        return;
      }
      if (result.blocked.length > 0) {
        // A refusal is news whether or not anything else published: the owner clicked to put
        // chapters live and some of them are not, so the ones that were held are named.
        const chapterNumbers = result.blocked.map((chapter) => chapter.number).join(", ");
        const message = t("chaptersPublishedWithBlocked", {
          count: result.published,
          blocked: result.blocked.length,
          chapters: chapterNumbers,
        });
        if (result.published > 0) toast.success(message);
        else toast.error(message);
        return;
      }
      toast.success(
        result.skipped > 0
          ? t("chaptersPublishedSkipped", {
              count: result.published,
              skipped: result.skipped,
            })
          : t("chaptersPublished", { count: result.published }),
      );
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("chapterPublishStateFailed")));
    },
  });

  const { mutate: backfillTitles, isPending: backfillingTitles } = useMutation({
    mutationFn: () => translateMissingTitles({ data: { novelId } }),
    onSuccess: ({ translated }) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
      toast.success(
        translated > 0 ? t("titlesTranslated", { count: translated }) : t("noTitlesTranslated"),
      );
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("titlesTranslateFailed")));
    },
  });

  const { mutate: deleteAllTranslations, isPending: deletingAllTranslations } = useMutation({
    mutationFn: () => deleteAllNovelTranslations({ data: { novelId } }),
    onSuccess: ({ chaptersCleared }) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novel", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      queryClient.invalidateQueries({ queryKey: ["adminNovelDetailMetrics", novelId] });
      onTranslationsDeleted();
      toast.success(
        chaptersCleared > 0
          ? t("translationsDeleted", { count: chaptersCleared })
          : t("noTranslationsToDelete"),
      );
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("translationsDeleteFailed")));
    },
  });
  const { mutateAsync: saveChapterOrder, isPending: reorderingChapters } = useMutation({
    mutationFn: (chapterIds: string[]) => reorderChapters({ data: { novelId, chapterIds } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] }),
        queryClient.invalidateQueries({ queryKey: ["novel", novelId] }),
        invalidateNovelChapterDetails(queryClient, novelId),
      ]);
      toast.success(t("chapterOrderSaved"));
    },
    onError: (error) => {
      toast.error(translateServerError(error, tRoot, t("chapterOrderFailed")));
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
    publishingChapterId,
    publishAllChapters,
    publishingAll,
    backfillTitles,
    backfillingTitles,
    deleteAllTranslations,
    deletingAllTranslations,
    saveChapterOrder,
    reorderingChapters,
  };
}
