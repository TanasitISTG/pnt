import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback } from "react";
import { AddChapterSection } from "@/components/chapters/add-chapter-section";
import { useTranslationJob } from "@/components/translation/use-translation-job";
import { JobLogsDialog } from "@/components/translation/job-logs-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { NovelHeader } from "@/components/novels/novel-header";
import { ChaptersToolbar } from "@/components/chapters/chapters-toolbar";
import { ChaptersTableSection } from "@/components/chapters/chapters-table-section";
import { TranslationQualityPanel } from "@/components/translation/translation-quality-panel";
import { useChapterSelection } from "@/components/chapters/use-chapter-selection";
import { useChapterTitleEdit } from "@/components/chapters/use-chapter-title-edit";
import { useNovelDetailMutations } from "@/components/novels/use-novel-detail-mutations";
import { useNovelExport } from "@/components/novels/use-novel-export";
import { getReaderProgress } from "@/lib/reader/progress";
import type { ReaderProgress } from "@/lib/reader/types";

import { getNovel } from "@/lib/content/novel.functions";
import { listChapters } from "@/lib/content/chapter.functions";
import { getResidualHanziChapters } from "@/lib/content/chapter-ops.functions";
import { getGlossaryStats } from "@/lib/glossary/functions";
import { getNovelCosts } from "@/lib/translation/api/queries";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId],
    queryFn: () => listChapters({ data: { novelId } }),
  });

const glossaryStatsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["glossaryStats", novelId],
    queryFn: () => getGlossaryStats({ data: { novelId } }),
  });

const costsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["costs", novelId],
    queryFn: () => getNovelCosts({ data: { novelId } }),
  });

const residualHanziQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["residualHanzi", novelId],
    queryFn: () => getResidualHanziChapters({ data: { novelId } }),
  });

export const Route = createFileRoute("/_public/novels/$novelId/")({
  loader: async ({ params, context }) => {
    const novelPromise = context.queryClient.ensureQueryData(novelQueryOptions(params.novelId));
    const tasks: Promise<unknown>[] = [
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
      ...(context.user
        ? [
            context.queryClient.ensureQueryData(glossaryStatsQueryOptions(params.novelId)),
            context.queryClient.ensureQueryData(costsQueryOptions(params.novelId)),
          ]
        : []),
    ];
    const [novel] = await Promise.all([novelPromise, ...tasks]);
    if (!novel) {
      throw notFound();
    }
    return { novel };
  },
  head: ({ loaderData }) => {
    const novel = loaderData?.novel;
    const title = novel
      ? `${novel.title} | Pnt - Personal Novel Translator`
      : "Novel Detail | Pnt - Personal Novel Translator";
    const description = novel?.description
      ? novel.description.length > 160
        ? `${novel.description.slice(0, 157)}...`
        : novel.description
      : "Read translated web novel chapters.";
    const appUrl = import.meta.env.VITE_APP_URL;
    const coverBaseUrl = novel?.hasCover ? `/api/covers/${novel.id}` : null;
    const coverUrl = novel?.hasCover ? `${appUrl ?? ""}${coverBaseUrl}` : undefined;
    const version = novel?.updatedAt ? new Date(novel.updatedAt).getTime() : null;
    const versionParam = version ? `&v=${version}` : "";

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(coverUrl ? [{ property: "og:image", content: coverUrl }] : []),
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(coverUrl ? [{ name: "twitter:image", content: coverUrl }] : []),
      ],
      links: coverBaseUrl
        ? [
            {
              rel: "preload",
              as: "image",
              href: `${coverBaseUrl}?w=480${versionParam}`,
              fetchPriority: "high",
            },
          ]
        : [],
    };
  },
  component: NovelDetailPage,
});

function NovelDetailPage() {
  const { novelId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const {
    data: novel,
    isError: isNovelError,
    error: novelError,
    refetch: refetchNovel,
  } = useQuery(novelQueryOptions(novelId));
  const {
    data: chapters = [],
    isError: isChaptersError,
    error: chaptersError,
    refetch: refetchChapters,
  } = useQuery(chaptersQueryOptions(novelId));
  const { data: glossaryStats } = useQuery({
    ...glossaryStatsQueryOptions(novelId),
    enabled: !!user,
  });
  const { data: costData } = useQuery({ ...costsQueryOptions(novelId), enabled: !!user });
  const { data: residualHanziChapters = [] } = useQuery({
    ...residualHanziQueryOptions(novelId),
    enabled: !!user,
  });

  const residualHanziMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of residualHanziChapters) {
      map.set(item.chapterId, item.count);
    }
    return map;
  }, [residualHanziChapters]);

  const [readerProgress, setReaderProgress] = useState<ReaderProgress>({
    lastChapterId: null,
    readChapterIds: [],
  });
  const readChapterIdSet = useMemo(
    () => new Set(readerProgress.readChapterIds),
    [readerProgress.readChapterIds],
  );
  const [retranslateChapterId, setRetranslateChapterId] = useState<string | null>(null);
  const [deleteNovelOpen, setDeleteNovelOpen] = useState(false);
  const [deleteAllTranslationsOpen, setDeleteAllTranslationsOpen] = useState(false);
  const [logChapterId, setLogChapterId] = useState<string | null>(null);

  useEffect(() => {
    setReaderProgress(getReaderProgress(novelId));
  }, [novelId]);

  const lastReadChapter = useMemo(() => {
    if (!readerProgress.lastChapterId) return null;
    return chapters.find((c) => c.id === readerProgress.lastChapterId) ?? null;
  }, [chapters, readerProgress.lastChapterId]);

  const firstChapter = chapters[0] ?? null;

  const {
    start: startTranslate,
    startMany: startBatchTranslate,
    cancel: cancelTranslate,
    retry: retryTranslate,
    clearActiveJobs,
    activeJobs,
  } = useTranslationJob(novelId, !!user);

  const handleTranslationsDeleted = useCallback(() => {
    clearActiveJobs();
    setDeleteAllTranslationsOpen(false);
  }, [clearActiveJobs]);

  const {
    selectedIds,
    setSelectedIds,
    selectableIds,
    allSelected,
    toggleSelect,
    toggleSelectAll,
    selectByRange,
    batchStarting,
    batchRangeFrom,
    setBatchRangeFrom,
    batchRangeTo,
    setBatchRangeTo,
    handleBatchTranslate,
    isRowTranslating,
  } = useChapterSelection(chapters, activeJobs, startBatchTranslate);

  const {
    editState,
    setEditState,
    editErrors,
    savingTitle,
    handleStartEdit,
    handleSaveEdit,
    handleTitleChange,
  } = useChapterTitleEdit(novelId);

  const {
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
  } = useNovelDetailMutations(novelId, handleTranslationsDeleted);
  const handleCancelEdit = useCallback(() => {
    setEditState(null);
  }, [setEditState]);
  const invalidateChapters = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
  }, [queryClient, novelId]);

  const missingTitleCount = useMemo(
    () => chapters.filter((c) => c.status === "translated" && !c.translatedTitle).length,
    [chapters],
  );

  const unpublishedCount = useMemo(
    () => chapters.filter((c) => !c.publishedAt || new Date(c.publishedAt) > new Date()).length,
    [chapters],
  );

  const { exporting, handleExportTxt, handleExportEpub } = useNovelExport(novelId);

  if (isNovelError || isChaptersError) {
    return (
      <QueryErrorState
        title="Failed to load novel"
        error={novelError || chaptersError}
        onRetry={() => {
          refetchNovel();
          refetchChapters();
        }}
        className="min-h-[40vh] my-12"
      />
    );
  }

  if (!novel) {
    return (
      <div className="text-center py-12">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <p className="text-muted-foreground mt-2">The novel you are looking for does not exist.</p>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }

  const chapterTableProps = {
    novelId,
    isAdmin: !!user,
    activeJobs,
    readChapterIdSet,
    residualHanziMap,
    costData,
    selectedIds,
    allSelected,
    isTranslating: isRowTranslating,
    onToggleSelect: toggleSelect,
    onToggleSelectAll: toggleSelectAll,
    publishingChapterId,
    onPublishChapter: publishChapter,
    onCancelTranslate: cancelTranslate,
    onRetryTranslate: retryTranslate,
    onStartTranslate: startTranslate,
    onRequestRetranslate: setRetranslateChapterId,
    onViewLogs: setLogChapterId,
    editingChapterId: editState?.chapterId ?? null,
    titleEdit: editState,
    editErrors,
    savingTitle,
    onTitleChange: handleTitleChange,
    onSaveTitle: handleSaveEdit,
    onStartEdit: handleStartEdit,
    onCancelEdit: handleCancelEdit,
    onDeleteChapter: setDeleteChapterId,
    reorderingChapters,
    onReorderChapters: saveChapterOrder,
    refetchChapters,
  };

  return (
    <div className="flex flex-col gap-8">
      <NovelHeader
        novel={novel}
        novelId={novelId}
        isAdmin={!!user}
        glossaryStats={glossaryStats}
        costData={costData}
        chapters={chapters}
        lastReadChapter={lastReadChapter}
        firstChapter={firstChapter}
        exporting={exporting}
        publishingNovel={publishingNovel}
        onPublishNovel={publishNovel}
        onExportTxt={handleExportTxt}
        onExportEpub={handleExportEpub}
        onDeleteNovel={() => setDeleteNovelOpen(true)}
      />

      <hr className="border-border" />

      {user && <TranslationQualityPanel novelId={novelId} />}

      {/* Chapters Table */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sub font-semibold text-foreground tracking-tight">Chapters</h2>
          <ChaptersToolbar
            isAdmin={!!user}
            selectedCount={selectedIds.size}
            selectableCount={selectableIds.length}
            batchStarting={batchStarting}
            onBatchTranslate={handleBatchTranslate}
            onClearSelection={() => setSelectedIds(new Set())}
            batchRangeFrom={batchRangeFrom}
            batchRangeTo={batchRangeTo}
            onBatchRangeFromChange={setBatchRangeFrom}
            onBatchRangeToChange={setBatchRangeTo}
            onSelectRange={selectByRange}
            unpublishedCount={unpublishedCount}
            onPublishAll={() => publishAllChapters()}
            publishingAll={publishingAll}
            missingTitleCount={missingTitleCount}
            onBackfillTitles={() => backfillTitles()}
            backfillingTitles={backfillingTitles}
            chapterCount={chapters.length}
            deletingAllTranslations={deletingAllTranslations}
            onDeleteAllTranslations={() => setDeleteAllTranslationsOpen(true)}
          />
        </div>

        <ChaptersTableSection chapters={chapters} isAdmin={!!user} tableProps={chapterTableProps} />
      </div>

      {user && (
        <AddChapterSection
          novelId={novelId}
          chapters={chapters}
          invalidateChapters={invalidateChapters}
        />
      )}

      {/* Confirmation Dialogs */}
      <DeleteConfirmDialog
        title="Delete Novel Project"
        description="Are you absolutely sure you want to delete this novel? This action is permanent and will delete all chapters, glossaries, and translation jobs associated with it."
        open={deleteNovelOpen}
        onOpenChange={setDeleteNovelOpen}
        onConfirm={removeNovel}
        pending={deletingNovel}
      />

      <DeleteConfirmDialog
        title="Delete All Translations"
        description="This permanently deletes translated titles, chapter text, chapter summaries, and the story summary for this novel. Active translation jobs will be cancelled. Raw chapters, publishing settings, and translation job history are kept."
        open={deleteAllTranslationsOpen}
        onOpenChange={setDeleteAllTranslationsOpen}
        onConfirm={() => deleteAllTranslations()}
        pending={deletingAllTranslations}
      />

      <DeleteConfirmDialog
        title="Delete Chapter"
        description="Are you sure you want to delete this chapter? This action is permanent and cannot be undone."
        open={deleteChapterId !== null}
        onOpenChange={(open) => !open && setDeleteChapterId(null)}
        onConfirm={() => deleteChapterId && removeChapter({ chapterId: deleteChapterId })}
        pending={deletingChapter}
      />

      <JobLogsDialog
        chapterId={logChapterId}
        open={logChapterId !== null}
        onOpenChange={(open) => !open && setLogChapterId(null)}
      />

      <ConfirmDialog
        title="Overwrite Edited Translation?"
        description="This chapter was manually edited. Re-translating will overwrite your manual changes with a new machine translation."
        confirmText="Overwrite & Translate"
        open={retranslateChapterId !== null}
        onOpenChange={(open) => !open && setRetranslateChapterId(null)}
        onConfirm={() => {
          if (retranslateChapterId) {
            startTranslate(retranslateChapterId);
            setRetranslateChapterId(null);
          }
        }}
      />
    </div>
  );
}
