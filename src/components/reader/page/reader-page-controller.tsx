import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { ReaderSettings } from "@/lib/reader/types";
import { READER_LINE_HEIGHT, READER_MEASURE_REM } from "@/lib/reader/settings";
import type { ReaderStateApi } from "@/lib/reader/use-reader-state";
import { useTranslationJob } from "@/components/translation/job/use-translation-job";
import { alignParagraphArrays, splitParagraphs } from "@/lib/translation/text/paragraphs";
import type { ReaderTranslationStatus } from "@/components/reader/content/reader-content-types";
import { useChapterEditor } from "@/components/reader/editor/use-chapter-editor";
import { useChapterNav } from "@/components/reader/editor/use-chapter-nav";
import { useReaderHotkeys } from "./reader-page-hotkeys";
import { useReaderSearch } from "./use-reader-search";
import type {
  ReaderChapterSummary,
  ReaderOverlay,
} from "@/components/reader/controls/reader-toolbar";
import {
  type ReaderChapterData,
  type ReaderNovelData,
  type ReaderPageViewProps,
} from "./reader-page-view";

function getReaderTranslationStatus(
  activeJobStatus: string | undefined,
  chapterStatus: string,
): ReaderTranslationStatus {
  if (activeJobStatus === "pending") return "queued";
  if (activeJobStatus === "running") return "running";
  if (activeJobStatus === "error") return "error";
  if (activeJobStatus === "cancelled") return "cancelled";
  if (chapterStatus === "queued") return "queued";
  if (chapterStatus === "translating") return "running";
  if (chapterStatus === "error") return "error";
  if (chapterStatus === "cancelled") return "cancelled";
  return "idle";
}

export interface ReaderPageControllerProps {
  novelId: string;
  chapterId: string;
  chapter: ReaderChapterData;
  chapters: ReaderChapterSummary[];
  novel: ReaderNovelData;
  signedIn: boolean;
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  resolvedTheme: string | undefined;
  setTheme: (theme: string) => void;
  fontSizePx: number;
  readerState: ReaderStateApi;
  proseRef: RefObject<HTMLDivElement | null>;
  proseNode?: HTMLDivElement | null;
  onProseNodeChange?: (node: HTMLDivElement | null) => void;
  toolbarRef: RefObject<HTMLElement | null>;
}

export function useReaderPageController({
  novelId,
  chapterId,
  chapter,
  chapters,
  novel,
  signedIn,
  settings,
  update,
  theme,
  resolvedTheme,
  setTheme,
  fontSizePx,
  readerState,
  proseRef,
  proseNode,
  onProseNodeChange,
  toolbarRef,
}: ReaderPageControllerProps): ReaderPageViewProps {
  const queryClient = useQueryClient();
  // Ownership, not sign-in, decides what the reader may change: any signed-in account can
  // read a published novel, but only its owner can edit, translate, or poll job status.
  const canManage = chapter.canManage;
  const [retranslateConfirmOpen, setRetranslateConfirmOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // One overlay at a time. `toc` and `appearance` belong to the pointer bar, `toc-sheet`
  // and `appearance-sheet` to the thumb bar; only one of each pair is ever reachable.
  const [overlay, setOverlay] = useState<ReaderOverlay | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const {
    start: startTranslate,
    activeJobs,
    activeJobsError,
    refetchActiveJobs,
  } = useTranslationJob(novelId, canManage);
  const activeJob = activeJobs.get(chapterId);
  const jobRunning =
    activeJob?.status === "pending" ||
    activeJob?.status === "running" ||
    chapter.status === "queued" ||
    chapter.status === "translating";
  const translationStatus = getReaderTranslationStatus(activeJob?.status, chapter.status);
  const editor = useChapterEditor({
    chapterId,
    novelId,
    chapter,
    canEdit: canManage,
    jobRunning,
  });
  const { prevChapter, nextChapter, goToChapter } = useChapterNav(novelId, chapterId, chapters);
  const rawParagraphs = useMemo(() => splitParagraphs(chapter.rawContent), [chapter.rawContent]);
  const translatedParagraphs = useMemo(
    () => (chapter.translatedContent ? splitParagraphs(chapter.translatedContent) : []),
    [chapter.translatedContent],
  );
  const aligned = useMemo(
    () =>
      translatedParagraphs.length > 0
        ? alignParagraphArrays(rawParagraphs, translatedParagraphs)
        : [],
    [rawParagraphs, translatedParagraphs],
  );
  const hasTranslation = translatedParagraphs.length > 0;
  const readChapterIdSet = useMemo(
    () => new Set(readerState.progress.readChapterIds),
    [readerState.progress.readChapterIds],
  );
  const search = useReaderSearch({
    viewMode: settings.viewMode,
    hasTranslation,
    rawParagraphs,
    translatedParagraphs,
    aligned,
    chapterKey: chapterId,
    enabled: !editor.editing,
  });
  const dialogOpen =
    overlay !== null ||
    menuOpen ||
    shortcutsOpen ||
    retranslateConfirmOpen ||
    editor.sourcePolicyDialogOpen ||
    editor.discardDialogOpen ||
    editor.blocker.status === "blocked";
  // Focus mode is not an overlay: the reader keeps reading, and every shortcut still works.
  const overlayOpen = dialogOpen || search.open;

  useReaderHotkeys({
    viewMode: settings.viewMode,
    resolvedTheme,
    canManage,
    editing: editor.editing,
    hasTranslation,
    chapterLoaded: true,
    jobRunning,
    overlayOpen,
    dialogOpen,
    prevChapter,
    nextChapter,
    onUpdateViewMode: (next) => update({ viewMode: next }),
    onSetTheme: setTheme,
    onBeginEditing: editor.beginEditing,
    onRequestCancelEditing: editor.requestCancelEditing,
    onSave: editor.handleSaveRequest,
    onGoToChapter: goToChapter,
    onSetShortcutsOpen: setShortcutsOpen,
    onOpenFind: search.openFind,
    onCloseFind: search.close,
    findOpen: search.open,
    focusMode,
    onToggleFocusMode: () => setFocusMode((current) => !current),
    onExitFocusMode: () => setFocusMode(false),
  });

  const previousJobStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const previousStatus = previousJobStatusRef.current;
    const currentStatus = activeJob?.status ?? null;
    previousJobStatusRef.current = currentStatus;
    const wasRunning = previousStatus === "pending" || previousStatus === "running";
    const isIdle = currentStatus !== "pending" && currentStatus !== "running";
    if (wasRunning && isIdle) {
      void queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] });
      void queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
    }
  }, [activeJob?.status, chapterId, novelId, queryClient]);

  const handleTranslateRequest = useCallback(() => {
    if (hasTranslation) {
      setRetranslateConfirmOpen(true);
      return;
    }
    void startTranslate(chapterId, "missing");
  }, [chapterId, hasTranslation, startTranslate]);

  const handleConfirmRetranslate = useCallback(() => {
    setRetranslateConfirmOpen(false);
    void startTranslate(chapterId, "overwrite");
  }, [chapterId, startTranslate]);

  const readerFontClass = settings.typeface === "reader" ? "font-reader" : undefined;

  return {
    novelId,
    novel,
    chapterId,
    chapter,
    chapters,
    readChapterIdSet,
    prevChapter,
    nextChapter,
    hasTranslation,
    aligned,
    rawParagraphs,
    translatedParagraphs,
    fontSizePx,
    lineHeight: READER_LINE_HEIGHT[settings.lineHeight],
    measureRem: READER_MEASURE_REM[settings.measure],
    readerFontClass,
    settings,
    update,
    signedIn,
    canManage,
    editing: editor.editing,
    jobRunning,
    translationStatus,
    translationStatusError: activeJobsError,
    retryTranslationStatus: refetchActiveJobs,
    theme,
    setTheme,
    activeJob,
    overlay,
    onOverlayChange: setOverlay,
    onMenuOpenChange: setMenuOpen,
    focusMode,
    onFocusModeChange: setFocusMode,
    onGoToChapter: goToChapter,
    onEditRequest: editor.beginEditing,
    onTranslateRequest: handleTranslateRequest,
    onShortcutsRequest: () => setShortcutsOpen(true),
    retranslateConfirmOpen,
    onRetranslateConfirmChange: setRetranslateConfirmOpen,
    onConfirmRetranslate: handleConfirmRetranslate,
    shortcutsOpen,
    onShortcutsOpenChange: setShortcutsOpen,
    discardDialogOpen: editor.discardDialogOpen,
    blockerStatus: editor.blocker.status,
    onDiscardDialogChange: editor.handleDiscardDialogChange,
    onKeepEditing: editor.keepEditing,
    onDiscardChanges: editor.discardChanges,
    sourcePolicyDialogOpen: editor.sourcePolicyDialogOpen,
    saving: editor.saving,
    onSourcePolicyChange: editor.handleSourcePolicyChange,
    onClearTranslation: () => editor.submitWithPolicy("clear"),
    onKeepTranslation: () => editor.submitWithPolicy("keep"),
    editorForm: editor.form,
    onSave: editor.handleSaveRequest,
    onCancel: editor.requestCancelEditing,
    readerState,
    search,
    proseRef,
    proseNode,
    onProseNodeChange,
    toolbarRef,
  };
}
