import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Download,
  HelpCircle,
  MoreHorizontal,
  Pencil,
  RotateCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

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
import type { ReaderSettings } from "@/lib/reader/types";
import type { ActiveJobState } from "@/lib/translation/types/api";
import { ReaderChapterDialog } from "./reader-chapter-dialog";
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
  panel: "chapters" | "settings" | null;
  onPanelChange: (panel: "chapters" | "settings" | null) => void;
  actionsOpen: boolean;
  onActionsOpenChange: (open: boolean) => void;
  onGoToChapter: (id: string) => void;
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
    <header className="sticky top-0 z-30 -mx-4 border-b border-border bg-background px-4 py-2 sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-[1200px] min-w-0 flex-col gap-2">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 sm:flex sm:gap-1.5">
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
          <div className="col-span-2 row-start-2 flex min-w-0 items-center justify-end gap-0.5 sm:contents">
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
        {jobRunning ? <ReaderJobStatus activeJob={activeJob} /> : null}
      </div>
    </header>
  );
}

function ReaderJobStatus({ activeJob }: { activeJob: ActiveJobState | undefined }) {
  if (!activeJob) {
    return (
      <div
        className="min-w-0 border-t border-border pt-2 text-caption text-muted-foreground"
        role="status"
      >
        Translation in progress
      </div>
    );
  }

  const percent =
    activeJob.totalChunks > 0
      ? Math.round((activeJob.doneChunks / activeJob.totalChunks) * 100)
      : 0;
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-border pt-2" role="status">
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
