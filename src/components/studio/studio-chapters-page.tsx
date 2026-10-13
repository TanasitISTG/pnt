import { QueryErrorState } from "@/components/query-error-state";
import { NovelDetailChapterPanel } from "./studio-chapters";
import { NovelDetailDialogs } from "./studio-dialogs";
import { StudioProgressCard } from "./studio-progress";
import { useChapterWorkspace } from "./use-chapter-workspace";

export interface StudioChaptersPageProps {
  novelId: string;
  chapterQuery: string;
  onChapterQueryChange: (query: string) => void;
  onAddChapters: () => void;
}

/**
 * The chapter workspace: the novel's rows with their translation, publishing and read state,
 * the bulk actions above them, and the novel-level summary above that. It is the studio's
 * landing section because it is where the work happens.
 */
export function StudioChaptersPage({
  novelId,
  chapterQuery,
  onChapterQueryChange,
  onAddChapters,
}: StudioChaptersPageProps) {
  const workspace = useChapterWorkspace(novelId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub">
          Chapters
        </h1>
        <p className="mt-0.5 text-body text-muted-foreground">
          Translate, publish and order this novel&rsquo;s chapters.
        </p>
      </div>

      <StudioProgressCard
        novelId={novelId}
        chapters={workspace.chapters}
        chaptersPending={workspace.chapterPanel.isChaptersPending}
        costData={workspace.costData}
        glossaryStats={workspace.glossaryStats}
      />

      {workspace.metrics.isError ? (
        <QueryErrorState
          title="Unable to refresh novel metrics"
          error={workspace.metrics.error}
          onRetry={() => {
            void workspace.metrics.refetch();
          }}
          className="my-0"
        />
      ) : null}

      <NovelDetailChapterPanel
        isAdmin
        chapterQuery={chapterQuery}
        detail={workspace.chapterPanel}
        tableProps={workspace.tableProps}
        onReviewSearchChange={onChapterQueryChange}
        onAddChapters={onAddChapters}
      />
      <NovelDetailDialogs detail={workspace.dialogProps} />
    </div>
  );
}
