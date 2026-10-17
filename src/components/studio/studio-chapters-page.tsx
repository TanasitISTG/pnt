import { useTranslations } from "use-intl";

import { QueryErrorState } from "@/components/query-error-state";
import { NovelExportMenu } from "./novel-export-menu";
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
 * landing section because it is where the work happens — which is also why the export menu
 * sits beside its heading: the file a reader downloads is made of the rows on this page.
 */
export function StudioChaptersPage({
  novelId,
  chapterQuery,
  onChapterQueryChange,
  onAddChapters,
}: StudioChaptersPageProps) {
  const t = useTranslations("studio");
  const workspace = useChapterWorkspace(novelId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub">
            {t("sectionChapters")}
          </h1>
          <p className="mt-0.5 text-body text-muted-foreground">{t("chaptersLead")}</p>
        </div>
        <NovelExportMenu novelId={novelId} />
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
          title={t("metricsRefreshFailed")}
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
