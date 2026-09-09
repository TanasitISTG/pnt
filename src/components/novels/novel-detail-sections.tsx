import { NovelHeader } from "@/components/novels/novel-header";
import { AddChapterSection } from "@/components/chapters/add-chapter-section";
import { NovelDetailChapterPanel } from "@/components/novels/novel-detail-chapter-panel";
import type { NovelDetailChapterPanelDetail } from "@/components/novels/novel-detail-chapter-panel";
import type { NovelDetailDialogDetail } from "@/components/novels/novel-detail-dialogs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TranslationQualityPanel } from "@/components/translation/translation-quality-panel";
import type { EvalReviewSearch } from "@/lib/translation/evaluation/eval.schemas";
import type { DetailSection, NovelDetailSearch } from "@/components/novels/novel-detail-search";
import type { ChapterRow } from "@/components/chapters/types";
import type { NovelHeaderProps } from "@/components/novels/novel-header";

export interface NovelDetailViewModel
  extends NovelDetailChapterPanelDetail, NovelDetailDialogDetail {
  novel: NovelHeaderProps["novel"] | undefined;
  glossaryStats: NovelHeaderProps["glossaryStats"];
  costData: NovelHeaderProps["costData"];
  firstChapter: ChapterRow | null;
  readingActionsPending: boolean;
  exporting: NovelHeaderProps["exporting"];
  publishingNovel: boolean;
  handleExportTxt: NovelHeaderProps["onExportTxt"];
  handleExportEpub: NovelHeaderProps["onExportEpub"];
  publishNovel: NovelHeaderProps["onPublishNovel"];
  chaptersReady: boolean;
  invalidateChapters: () => void;
}

export interface NovelDetailSectionsProps {
  novelId: string;
  isAdmin: boolean;
  section: DetailSection;
  addVisited: boolean;
  reviewSearch: NovelDetailSearch;
  detail: NovelDetailViewModel;
  onSectionChange: (section: string) => void;
  onReviewSearchChange: (patch: Partial<NovelDetailSearch>) => void;
}

export function NovelDetailSections({
  novelId,
  isAdmin,
  section,
  addVisited,
  reviewSearch,
  detail,
  onSectionChange,
  onReviewSearchChange,
}: NovelDetailSectionsProps) {
  const {
    novel,
    glossaryStats,
    costData,
    chapters,
    lastReadChapter,
    firstChapter,
    exporting,
    publishingNovel,
    readingActionsPending,
    chapterUiLoading,
    invalidateChapters,
    handleExportTxt,
    handleExportEpub,
    publishNovel,
    setDeleteNovelOpen,
  } = detail;

  if (!novel) return null;

  const chapterPanel = (
    <NovelDetailChapterPanel
      isAdmin={isAdmin}
      chapterQuery={reviewSearch.chapterQuery ?? ""}
      detail={detail}
      onReviewSearchChange={(query) => onReviewSearchChange({ chapterQuery: query })}
      onAddChapters={isAdmin ? () => onSectionChange("add") : undefined}
    />
  );

  return (
    <>
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
        readingActionsPending={readingActionsPending}
        onPublishNovel={publishNovel}
        onExportTxt={handleExportTxt}
        onExportEpub={handleExportEpub}
        onDeleteNovel={() => setDeleteNovelOpen(true)}
      />

      <hr className="border-border" />

      {isAdmin ? (
        <Tabs value={section} onValueChange={onSectionChange}>
          <TabsList aria-label="Novel sections">
            <TabsTrigger value="chapters">Chapters</TabsTrigger>
            <TabsTrigger value="add">Add chapters</TabsTrigger>
            <TabsTrigger value="quality">Translation quality</TabsTrigger>
          </TabsList>
          <TabsContent value="chapters" keepMounted>
            {chapterPanel}
          </TabsContent>
          <TabsContent value="add" keepMounted={addVisited}>
            {addVisited ? (
              detail.chaptersReady ? (
                <AddChapterSection
                  novelId={novelId}
                  chapters={chapters}
                  invalidateChapters={invalidateChapters}
                />
              ) : (
                <div className="rounded-xl border border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
                  Loading chapter tools…
                </div>
              )
            ) : null}
          </TabsContent>
          <TabsContent value="quality">
            {section === "quality" && detail.chaptersReady ? (
              <TranslationQualityPanel
                novelId={novelId}
                reviewSearch={reviewSearch}
                onReviewSearchChange={(patch: Partial<EvalReviewSearch>) =>
                  onReviewSearchChange(patch)
                }
              />
            ) : (
              <div className="rounded-xl border border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading translation quality…
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        chapterPanel
      )}
    </>
  );
}
