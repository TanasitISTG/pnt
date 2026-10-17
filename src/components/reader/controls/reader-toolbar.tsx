import { Link } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Download,
  HelpCircle,
  List,
  Maximize2,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Search,
} from "lucide-react";
import type { RefObject } from "react";

import { NovelTrail } from "@/components/novels/novel-context-bar";
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
import type { ReaderSearchApi } from "@/components/reader/page/use-reader-search";
import { ReaderAppearancePanel } from "./reader-appearance-panel";
import { ReaderAppearanceSheet } from "./reader-appearance-sheet";
import { ReaderChapterDrawer } from "./reader-chapter-drawer";
import { ReaderChapterProgress } from "./reader-chapter-progress";
import { ReaderFindBar } from "./reader-find-bar";

export interface ReaderChapterSummary {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
}

/** One overlay is open at a time; the key names the container, not the preference. */
export type ReaderOverlay = "toc" | "toc-sheet" | "appearance" | "appearance-sheet" | "bookmarks";

export interface ReaderToolbarProps {
  novelId: string;
  novelTitle: string;
  chapterId: string;
  chapter: ReaderChapterSummary & {
    translatedContent: string | null;
    editedAt: Date | string | null;
  };
  chapters: ReaderChapterSummary[];
  /** Chapters the viewer has finished, for the drawer's read markers. */
  readChapterIdSet: ReadonlySet<string>;
  prevChapter: ReaderChapterSummary | null;
  nextChapter: ReaderChapterSummary | null;
  hasTranslation: boolean;
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  canManage: boolean;
  editing: boolean;
  jobRunning: boolean;
  activeJob: ActiveJobState | undefined;
  search: ReaderSearchApi;
  overlay: ReaderOverlay | null;
  onOverlayChange: (overlay: ReaderOverlay | null) => void;
  /** The actions menu reports itself so the reader's shortcuts stand down while it is open. */
  onMenuOpenChange: (open: boolean) => void;
  onGoToChapter: (id: string, hash?: string) => void;
  onEditRequest: () => void;
  onTranslateRequest: () => void;
  onShortcutsRequest: () => void;
  focusMode: boolean;
  onFocusModeChange: (focus: boolean) => void;
  // Prose bounds drive progress and restore; the toolbar measures its own pinned offset.
  proseRef: RefObject<HTMLDivElement | null>;
  proseNode?: HTMLDivElement | null;
  toolbarRef: RefObject<HTMLElement | null>;
}

/**
 * The reader's chrome, in two pieces.
 *
 * Desktop keeps one slim bar: where you are, how far in you are, and the controls that
 * belong to the page. A phone gets a thumb bar along the bottom for the controls a
 * reader touches constantly, and leaves the top bar for the trail and search. Neither
 * bar animates on a chapter turn: chapter navigation is keyboard-fast and repeated all
 * session, and moving the chrome each time would make reading feel slower, not richer.
 *
 * Everything that used to be a modal here is anchored instead: the chapter list is a
 * drawer with search and read markers, reading settings are a popover on a pointer
 * screen and a sheet under a thumb, and bookmarks opened from the actions menu.
 */
export function ReaderToolbar({
  novelId,
  novelTitle,
  chapterId,
  chapter,
  chapters,
  readChapterIdSet,
  prevChapter,
  nextChapter,
  hasTranslation,
  settings,
  update,
  theme,
  setTheme,
  canManage,
  editing,
  jobRunning,
  activeJob,
  search,
  overlay,
  onOverlayChange,
  onMenuOpenChange,
  onGoToChapter,
  onEditRequest,
  onTranslateRequest,
  onShortcutsRequest,
  focusMode,
  onFocusModeChange,
  proseRef,
  proseNode,
  toolbarRef,
}: ReaderToolbarProps) {
  const t = useTranslations("reader");
  const tCommon = useTranslations("common");
  const chapterLabel = tCommon("chapterShort", { number: Number(chapter.number) });
  const appearanceControls = {
    settings,
    update,
    theme,
    setTheme,
    hasTranslation,
    editing,
  };

  const actionsMenu = (size: "icon" | "readerBar") => (
    <DropdownMenu onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            className={size === "icon" ? "size-11 shrink-0" : undefined}
          />
        }
        aria-label={t("moreActions")}
        title={t("moreActions")}
      >
        <MoreHorizontal className={size === "icon" ? "size-4" : "size-5"} aria-hidden="true" />
        {size === "readerBar" ? t("more") : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[60] w-56">
        <DropdownMenuGroup>
          {canManage && !editing && !jobRunning ? (
            <DropdownMenuItem onClick={onEditRequest}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("editChapter")}
            </DropdownMenuItem>
          ) : null}
          {canManage && !editing && !jobRunning ? (
            <DropdownMenuItem onClick={onTranslateRequest}>
              <RotateCw className="size-4" aria-hidden="true" />
              {hasTranslation ? t("retranslateChapter") : t("translateChapter")}
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
              {t("downloadChapter")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => onOverlayChange("bookmarks")}>
            <Bookmark className="size-4" aria-hidden="true" />
            {t("bookmarks")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onFocusModeChange(!focusMode)}>
            <Maximize2 className="size-4" aria-hidden="true" />
            {focusMode ? t("exitFocusMode") : t("focusMode")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onShortcutsRequest}>
            <HelpCircle className="size-4" aria-hidden="true" />
            {t("keyboardShortcuts")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {focusMode ? null : (
        <header
          ref={toolbarRef}
          className="sticky top-0 z-30 -mx-4 border-b border-border bg-background sm:-mx-6"
        >
          <div className="mx-auto flex max-w-[1200px] min-w-0 flex-col px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-1 py-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                render={<Link to="/{-$locale}/novels/$novelId" params={{ novelId }} />}
                aria-label={t("backToNovel")}
                title={t("backToNovel")}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
              <NovelTrail
                novelId={novelId}
                title={novelTitle}
                current="chapter"
                chapterLabel={chapterLabel}
                className="min-w-0"
              />
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {!editing ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 md:hidden"
                    onClick={() => (search.open ? search.close() : search.openFind())}
                    aria-label={t("findInChapter")}
                    aria-pressed={search.open}
                    title={t("findInChapter")}
                  >
                    <Search className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
                <div className="hidden items-center gap-0.5 md:flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    disabled={!prevChapter}
                    onClick={() => prevChapter && onGoToChapter(prevChapter.id)}
                    aria-label={t("previousChapter")}
                    title={t("previousChapterShortcut")}
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    disabled={!nextChapter}
                    onClick={() => nextChapter && onGoToChapter(nextChapter.id)}
                    aria-label={t("nextChapter")}
                    title={t("nextChapterShortcut")}
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                  <ReaderChapterDrawer
                    chapters={chapters}
                    chapterId={chapterId}
                    readChapterIdSet={readChapterIdSet}
                    open={overlay === "toc"}
                    onOpenChange={(open) => onOverlayChange(open ? "toc" : null)}
                    onGoToChapter={onGoToChapter}
                    side="end"
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0"
                        aria-label={t("chapters")}
                        title={t("chapters")}
                      >
                        <List className="size-4" aria-hidden="true" />
                      </Button>
                    }
                  />
                  {!editing ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      onClick={() => (search.open ? search.close() : search.openFind())}
                      aria-label={t("findInChapter")}
                      aria-pressed={search.open}
                      title={t("findInChapterShortcut")}
                    >
                      <Search className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                  <ReaderAppearancePanel
                    {...appearanceControls}
                    open={overlay === "appearance"}
                    onOpenChange={(open) => onOverlayChange(open ? "appearance" : null)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    onClick={() => onFocusModeChange(true)}
                    aria-label={t("focusMode")}
                    title={t("focusModeShortcut")}
                  >
                    <Maximize2 className="size-4" aria-hidden="true" />
                  </Button>
                  {actionsMenu("icon")}
                </div>
              </div>
            </div>
            {search.open ? <ReaderFindBar search={search} /> : null}
            {jobRunning ? <ReaderJobStatus activeJob={activeJob} /> : null}
          </div>
          <ReaderChapterProgress
            proseRef={proseRef}
            proseNode={proseNode}
            toolbarRef={toolbarRef}
          />
        </header>
      )}

      {focusMode ? null : (
        <nav
          aria-label={t("toolbarLabel")}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-safe-bottom supports-backdrop-filter:backdrop-blur-sm md:hidden"
        >
          <div className="grid grid-cols-5 gap-0.5 px-1.5 py-1">
            <ReaderChapterDrawer
              chapters={chapters}
              chapterId={chapterId}
              readChapterIdSet={readChapterIdSet}
              open={overlay === "toc-sheet"}
              onOpenChange={(open) => onOverlayChange(open ? "toc-sheet" : null)}
              onGoToChapter={onGoToChapter}
              side="bottom"
              trigger={
                <Button variant="ghost" size="readerBar" aria-label={t("chapters")}>
                  <List className="size-5" aria-hidden="true" />
                  {t("chapters")}
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="readerBar"
              disabled={!prevChapter}
              onClick={() => prevChapter && onGoToChapter(prevChapter.id)}
              aria-label={t("previousChapter")}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
              {t("previous")}
            </Button>
            <Button
              variant="ghost"
              size="readerBar"
              disabled={!nextChapter}
              onClick={() => nextChapter && onGoToChapter(nextChapter.id)}
              aria-label={t("nextChapter")}
            >
              <ChevronRight className="size-5" aria-hidden="true" />
              {t("next")}
            </Button>
            <ReaderAppearanceSheet
              {...appearanceControls}
              triggerSize="readerBar"
              open={overlay === "appearance-sheet"}
              onOpenChange={(open) => onOverlayChange(open ? "appearance-sheet" : null)}
            />
            {actionsMenu("readerBar")}
          </div>
        </nav>
      )}
    </>
  );
}

function ReaderJobStatus({ activeJob }: { activeJob: ActiveJobState | undefined }) {
  const t = useTranslations("reader");
  if (!activeJob) {
    return (
      <div className="min-w-0 pb-2 text-caption text-muted-foreground" role="status">
        {t("translationPending")}
      </div>
    );
  }

  const percent =
    activeJob.totalChunks > 0
      ? Math.round((activeJob.doneChunks / activeJob.totalChunks) * 100)
      : 0;
  return (
    <div className="flex min-w-0 items-center gap-2 pb-2" role="status">
      <span className="shrink-0 text-caption text-muted-foreground">{t("translating")}</span>
      <Progress
        value={percent}
        className="h-1.5 min-w-0 max-w-48 flex-1"
        aria-label={t("translationProgress")}
      />
      <span className="shrink-0 text-caption text-muted-foreground">
        {activeJob.doneChunks}/{activeJob.totalChunks}
      </span>
    </div>
  );
}
