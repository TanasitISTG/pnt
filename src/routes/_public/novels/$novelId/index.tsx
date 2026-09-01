import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AddChapterSection } from "@/components/chapters/add-chapter-section";
import { ChapterReorderDialogFallback } from "@/components/chapters/chapter-reorder-dialog-fallback";
import { ChaptersTableSection } from "@/components/chapters/chapters-table-section";
import { ChaptersToolbar } from "@/components/chapters/chapters-toolbar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { JobLogsDialog } from "@/components/translation/job-logs-dialog";
import { NovelHeader } from "@/components/novels/novel-header";
import { NovelPending } from "@/components/novels/novel-detail-pending";
import { QueryErrorState } from "@/components/query-error-state";
import { TranslationQualityPanel } from "@/components/translation/translation-quality-panel";
import {
  chaptersQueryOptions,
  novelQueryOptions,
  useNovelDetailPage,
} from "@/components/novels/use-novel-detail-page";
import { Button } from "@/components/ui/button";

const LazyChapterReorderDialog = lazy(async () => {
  const module = await import("@/components/chapters/chapter-reorder-dialog");
  return { default: module.ChapterReorderDialog };
});

export const Route = createFileRoute("/_public/novels/$novelId/")({
  loader: async ({ params, context }) => {
    const novelPromise = context.queryClient.ensureQueryData(novelQueryOptions(params.novelId));
    if (context.user) {
      const novel = await novelPromise;
      if (!novel) {
        throw notFound();
      }
      return { novel };
    }

    const [novel] = await Promise.all([
      novelPromise,
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
    ]);
    if (!novel) {
      throw notFound();
    }
    return { novel };
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: NovelPending,
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
  remountDeps: ({ params }) => ({ novelId: params.novelId }),
  component: NovelDetailPage,
});

function NovelDetailPage() {
  const { novelId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const isAdmin = !!user;
  const {
    backfillTitles,
    backfillingTitles,
    batchRangeFrom,
    batchRangeTo,
    batchStarting,
    chapterTableProps,
    chapterUiLoading,
    chapters,
    chaptersError,
    chaptersReady,
    costData,
    deleteAllTranslations,
    deleteAllTranslationsOpen,
    deleteChapterId,
    deleteNovelOpen,
    deletingAllTranslations,
    deletingChapter,
    deletingNovel,
    exporting,
    firstChapter,
    glossaryStats,
    handleBatchTranslate,
    handleExportEpub,
    handleExportTxt,
    handleSaveChapterOrder,
    invalidateChapters,
    isChaptersError,
    isNovelError,
    lastReadChapter,
    missingTitleCount,
    novel,
    novelError,
    publishAllChapters,
    publishNovel,
    publishingAll,
    publishingNovel,
    refetchChapters,
    refetchNovel,
    removeChapter,
    removeNovel,
    reorderDisabled,
    reorderOpen,
    reorderingChapters,
    selectableIds,
    selectedIds,
    setBatchRangeFrom,
    setBatchRangeTo,
    setDeleteAllTranslationsOpen,
    setDeleteChapterId,
    setDeleteNovelOpen,
    logChapterId,
    setLogChapterId,
    setReorderOpen,
    retranslateChapterId,
    startTranslate,
    setRetranslateChapterId,
    setSelectedIds,
    selectByRange,
    unpublishedCount,
  } = useNovelDetailPage(novelId, isAdmin);

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

  return (
    <div className="flex flex-col gap-8">
      <NovelHeader
        novel={novel}
        novelId={novelId}
        isAdmin={isAdmin}
        glossaryStats={glossaryStats}
        costData={costData}
        chapters={chapters}
        lastReadChapter={lastReadChapter}
        firstChapter={firstChapter}
        exporting={exporting}
        publishingNovel={publishingNovel}
        chaptersPending={chapterUiLoading}
        onPublishNovel={publishNovel}
        onExportTxt={handleExportTxt}
        onExportEpub={handleExportEpub}
        onDeleteNovel={() => setDeleteNovelOpen(true)}
      />

      <hr className="border-border" />

      {isAdmin && chaptersReady && <TranslationQualityPanel novelId={novelId} />}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sub font-semibold text-foreground tracking-tight">Chapters</h2>
          {!chapterUiLoading && (
            <ChaptersToolbar
              isAdmin={isAdmin}
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
              onReorderChapters={() => setReorderOpen(true)}
              reorderDisabled={reorderDisabled}
              chapterCount={chapters.length}
              deletingAllTranslations={deletingAllTranslations}
              onDeleteAllTranslations={() => setDeleteAllTranslationsOpen(true)}
            />
          )}
        </div>

        <ChaptersTableSection
          chapters={chapters}
          isAdmin={isAdmin}
          loading={chapterUiLoading}
          tableProps={chapterTableProps}
        />
      </div>

      {isAdmin && chaptersReady && (
        <AddChapterSection
          novelId={novelId}
          chapters={chapters}
          invalidateChapters={invalidateChapters}
        />
      )}

      {reorderOpen && (
        <Suspense
          fallback={
            <ChapterReorderDialogFallback
              chapterCount={chapters.length}
              saving={reorderingChapters}
              onOpenChange={setReorderOpen}
            />
          }
        >
          <LazyChapterReorderDialog
            chapters={chapters}
            saving={reorderingChapters}
            onOpenChange={setReorderOpen}
            onSave={handleSaveChapterOrder}
          />
        </Suspense>
      )}

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
