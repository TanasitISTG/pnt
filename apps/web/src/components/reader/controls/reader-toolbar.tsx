import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bookmark,
  Download,
  HelpCircle,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { downloadText, sanitizeFilename } from "@/lib/download";
import type { ReaderSettings } from "@pnt/contracts/reader";
import type { ReaderStateApi } from "@/lib/reader/use-reader-state";
import type { ActiveJobState } from "@/lib/translation/types/api";
import type { ReaderSearchApi } from "@/components/reader/page/use-reader-search";
import { ReaderBookmarksDialog } from "./reader-bookmarks-dialog";
import { ReaderChapterDialog } from "./reader-chapter-dialog";
import { ReaderChapterProgress } from "./reader-chapter-progress";
import { ReaderFindBar } from "./reader-find-bar";
import { ReaderSettingsPanel } from "./reader-settings-panel";

export interface ReaderChapterSummary {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
}

export interface ReaderToolbarProps {
  novelId: string;
  novelTitle: string;
  chapterId: string;
  chapter: ReaderChapterSummary & {
    translatedContent: string | null;
    editedAt: Date | string | null;
  };
  chapters: ReaderChapterSummary[];
  prevChapter: ReaderChapterSummary | null;
  nextChapter: ReaderChapterSummary | null;
  hasTranslation: boolean;
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  isAdmin: boolean;
  editing: boolean;
  jobRunning: boolean;
  activeJob: ActiveJobState | undefined;
  readerState: ReaderStateApi;
  search: ReaderSearchApi;
  // Prose bounds drive progress and restore; the toolbar measures its own pinned offset.
  proseRef: RefObject<HTMLDivElement | null>;
  proseNode?: HTMLDivElement | null;
  toolbarRef: RefObject<HTMLElement | null>;
  panel: "chapters" | "settings" | "bookmarks" | null;
  onPanelChange: (panel: "chapters" | "settings" | "bookmarks" | null) => void;
  actionsOpen: boolean;
  onActionsOpenChange: (open: boolean) => void;
  onGoToChapter: (id: string, hash?: string) => void;
  onEditRequest: () => void;
  onTranslateRequest: () => void;
  onShortcutsRequest: () => void;
}

export function ReaderToolbar({
  novelId,
  novelTitle,
  chapterId,
  chapter,
  chapters,
  prevChapter,
  nextChapter,
  hasTranslation,
  settings,
  update,
  theme,
  setTheme,
  isAdmin,
  editing,
  jobRunning,
  activeJob,
  readerState,
  search,
  proseRef,
  proseNode,
  toolbarRef,
  panel,
  onPanelChange,
  actionsOpen,
  onActionsOpenChange,
  onGoToChapter,
  onEditRequest,
  onTranslateRequest,
  onShortcutsRequest,
}: ReaderToolbarProps) {
  return (
    <header
      ref={toolbarRef}
      className="sticky top-0 z-30 -mx-4 border-b border-border bg-background sm:-mx-6"
    >
      <div className="mx-auto flex max-w-[1200px] min-w-0 flex-col px-4 sm:px-6">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1 py-1.5 sm:flex sm:gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="col-start-1 row-start-1 size-11 shrink-0 sm:col-auto sm:row-auto"
            render={<Link to="/novels/$novelId" params={{ novelId }} />}
            aria-label="Back to chapter list"
            title="Back to chapter list"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="col-start-2 row-start-1 min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {novelTitle}
          </span>
          <div className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center justify-end gap-0.5 sm:contents">
            <ReaderChapterDialog
              chapters={chapters}
              chapterId={chapterId}
              open={panel === "chapters"}
              onOpenChange={(open) => onPanelChange(open ? "chapters" : null)}
              onGoToChapter={onGoToChapter}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              disabled={!prevChapter}
              onClick={() => prevChapter && onGoToChapter(prevChapter.id)}
              aria-label="Previous chapter"
              title="Previous chapter (←)"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              disabled={!nextChapter}
              onClick={() => nextChapter && onGoToChapter(nextChapter.id)}
              aria-label="Next chapter"
              title="Next chapter (→)"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            {!editing ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                onClick={() => (search.open ? search.close() : search.openFind())}
                aria-label="Find in chapter"
                aria-pressed={search.open}
                title="Find in chapter (Ctrl/⌘+F)"
              >
                <Search className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            <ReaderBookmarksDialog
              chapterId={chapterId}
              chapters={chapters}
              readerState={readerState}
              isAdmin={isAdmin}
              editing={editing}
              open={panel === "bookmarks"}
              onOpenChange={(open) => onPanelChange(open ? "bookmarks" : null)}
              onGoToChapter={onGoToChapter}
            />
            <ReaderSettingsPanel
              settings={settings}
              update={update}
              theme={theme}
              setTheme={setTheme}
              open={panel === "settings"}
              onOpenChange={(open) => onPanelChange(open ? "settings" : null)}
              hasTranslation={hasTranslation}
              editing={editing}
            />
            <DropdownMenu open={actionsOpen} onOpenChange={onActionsOpenChange}>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}
                aria-label="More reader actions"
                title="More reader actions"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[60] w-56">
                <DropdownMenuGroup>
                  {isAdmin && !editing && !jobRunning ? (
                    <DropdownMenuItem onClick={onEditRequest}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Edit chapter
                    </DropdownMenuItem>
                  ) : null}
                  {isAdmin && !editing && !jobRunning ? (
                    <DropdownMenuItem onClick={onTranslateRequest}>
                      <RotateCw className="size-4" aria-hidden="true" />
                      {hasTranslation ? "Re-translate chapter" : "Translate chapter"}
                    </DropdownMenuItem>
                  ) : null}
                  {hasTranslation && !editing && !jobRunning ? (
                    <DropdownMenuItem
                      onClick={() =>
                        downloadText(
                          `${sanitizeFilename(`ch-${Number(chapter.number)}-${chapter.translatedTitle ?? chapter.title}`)}.txt`,
                          chapter.translatedContent ?? "",
                        )
                      }
                    >
                      <Download className="size-4" aria-hidden="true" />
                      Download chapter .txt
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onClick={() => {
                      onActionsOpenChange(false);
                      onPanelChange("bookmarks");
                    }}
                  >
                    <Bookmark className="size-4" aria-hidden="true" />
                    Bookmarks
                    {readerState.bookmarks.length > 0 || readerState.bookmarksHasMore
                      ? ` (${readerState.bookmarks.length}${readerState.bookmarksHasMore ? "+" : ""})`
                      : ""}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      onActionsOpenChange(false);
                      onShortcutsRequest();
                    }}
                  >
                    <HelpCircle className="size-4" aria-hidden="true" />
                    Keyboard shortcuts
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {search.open ? <ReaderFindBar search={search} /> : null}
        {jobRunning ? <ReaderJobStatus activeJob={activeJob} /> : null}
      </div>
      <ReaderChapterProgress
        proseRef={proseRef}
        proseNode={proseNode}
        toolbarRef={toolbarRef}
        layoutKey={`${chapterId}|${settings.viewMode}|${settings.fontSize}|${settings.typeface}|${settings.lineHeight}|${settings.measure}|${editing}|${hasTranslation}`}
      />
    </header>
  );
}

function ReaderJobStatus({ activeJob }: { activeJob: ActiveJobState | undefined }) {
  if (!activeJob) {
    return (
      <div className="min-w-0 pb-2 text-caption text-muted-foreground" role="status">
        Translation in progress
      </div>
    );
  }

  const percent =
    activeJob.totalChunks > 0
      ? Math.round((activeJob.doneChunks / activeJob.totalChunks) * 100)
      : 0;
  return (
    <div className="flex min-w-0 items-center gap-2 pb-2" role="status">
      <span className="shrink-0 text-caption text-muted-foreground">Translating…</span>
      <Progress
        value={percent}
        className="h-1.5 min-w-0 max-w-48 flex-1"
        aria-label="Translation progress"
      />
      <span className="shrink-0 text-caption text-muted-foreground">
        {activeJob.doneChunks}/{activeJob.totalChunks}
      </span>
    </div>
  );
}
