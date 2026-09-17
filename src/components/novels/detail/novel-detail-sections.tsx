import { QueryErrorState } from "@/components/query-error-state";
import { NovelHeader } from "@/components/novels/detail/novel-header";
import type { NovelHeaderProps } from "@/components/novels/detail/novel-header";
import { AddChapterSection } from "@/components/chapters/import/add-chapter-section";
import { NovelDetailChapterPanel } from "@/components/novels/detail/novel-detail-chapter-panel";
import type { NovelDetailChapterPanelDetail } from "@/components/novels/detail/novel-detail-chapter-panel";
import type { ChapterTableProps } from "@/components/chapters/table/chapter-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TranslationQualityPanel } from "@/components/translation/evaluation/translation-quality-panel";
import type { EvalReviewSearch } from "@/lib/translation/evaluation/eval.schemas";
import type {
  DetailSection,
  NovelDetailSearch,
} from "@/components/novels/detail/novel-detail-search";

export interface NovelDetailSectionData {
  header: Omit<NovelHeaderProps, "novel" | "novelId" | "isAdmin">;
  chapterPanel: NovelDetailChapterPanelDetail;
  metrics: {
    error: unknown;
    isError: boolean;
    refetch: () => Promise<unknown>;
  };
  chapterTools: {
    ready: boolean;
    invalidateChapters: () => void;
  };
}

export interface NovelDetailSectionsProps {
  novel: NovelHeaderProps["novel"];
  novelId: string;
  isAdmin: boolean;
  section: DetailSection;
  addVisited: boolean;
  reviewSearch: NovelDetailSearch;
  detail: NovelDetailSectionData;
  tableProps: Omit<ChapterTableProps, "chapters">;
  onSectionChange: (section: string) => void;
  onReviewSearchChange: (patch: Partial<NovelDetailSearch>) => void;
}

export function NovelDetailSections({
  novel,
  novelId,
  isAdmin,
  section,
  addVisited,
  reviewSearch,
  detail,
  tableProps,
  onSectionChange,
  onReviewSearchChange,
}: NovelDetailSectionsProps) {
  const { chapters } = detail.header;
  const { chapterPanel, chapterTools, metrics } = detail;

  const panel = (
    <NovelDetailChapterPanel
      isAdmin={isAdmin}
      chapterQuery={reviewSearch.chapterQuery ?? ""}
      detail={chapterPanel}
      tableProps={tableProps}
      onReviewSearchChange={(query) => onReviewSearchChange({ chapterQuery: query })}
      onAddChapters={isAdmin ? () => onSectionChange("add") : undefined}
    />
  );

  return (
    <>
      <NovelHeader novel={novel} novelId={novelId} isAdmin={isAdmin} {...detail.header} />
      <hr className="border-border" />

      {isAdmin && metrics.isError ? (
        <QueryErrorState
          title="Failed to refresh novel metrics"
          error={metrics.error}
          onRetry={() => {
            void metrics.refetch();
          }}
          className="my-0 p-4"
        />
      ) : null}

      {isAdmin ? (
        <Tabs value={section} onValueChange={onSectionChange}>
          <TabsList aria-label="Novel sections">
            <TabsTrigger value="chapters">Chapters</TabsTrigger>
            <TabsTrigger value="add">Add chapters</TabsTrigger>
            <TabsTrigger value="quality">Translation quality</TabsTrigger>
          </TabsList>
          <TabsContent value="chapters" keepMounted>
            {panel}
          </TabsContent>
          <TabsContent value="add" keepMounted={addVisited}>
            {addVisited ? (
              chapterTools.ready ? (
                <AddChapterSection
                  novelId={novelId}
                  chapters={chapters}
                  invalidateChapters={chapterTools.invalidateChapters}
                />
              ) : (
                <div className="rounded-xl border border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
                  Loading chapter tools…
                </div>
              )
            ) : null}
          </TabsContent>
          <TabsContent value="quality">
            {section === "quality" && chapterTools.ready ? (
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
        panel
      )}
    </>
  );
}
