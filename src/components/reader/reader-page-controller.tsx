import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ReaderSettings } from "@/lib/reader/types";
import { useTranslationJob } from "@/components/translation/use-translation-job";
import { alignParagraphArrays, splitParagraphs } from "@/lib/translation/text/paragraphs";
import type { ReaderTranslationStatus } from "./reader-content-types";
import { useChapterEditor } from "./use-chapter-editor";
import { useChapterNav } from "./use-chapter-nav";
import { useReaderHotkeys } from "./reader-page-hotkeys";
import type { ReaderChapterSummary } from "./reader-toolbar";
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
  user: unknown;
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  resolvedTheme: string | undefined;
  setTheme: (theme: string) => void;
  fontSizePx: number;
}

export function useReaderPageController({
  novelId,
  chapterId,
  chapter,
  chapters,
  novel,
  user,
  settings,
  update,
  theme,
  resolvedTheme,
  setTheme,
  fontSizePx,
}: ReaderPageControllerProps): ReaderPageViewProps {
  const queryClient = useQueryClient();
  const [retranslateConfirmOpen, setRetranslateConfirmOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [panel, setPanel] = useState<"chapters" | "settings" | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const {
    start: startTranslate,
    activeJobs,
    activeJobsError,
    refetchActiveJobs,
  } = useTranslationJob(novelId, !!user);
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
    canEdit: !!user,
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
  const overlayOpen =
    panel !== null ||
    actionsOpen ||
    shortcutsOpen ||
    retranslateConfirmOpen ||
    editor.sourcePolicyDialogOpen ||
    editor.discardDialogOpen ||
    editor.blocker.status === "blocked";

  useReaderHotkeys({
    viewMode: settings.viewMode,
    resolvedTheme,
    user,
    editing: editor.editing,
    hasTranslation,
    chapterLoaded: true,
    jobRunning,
    overlayOpen,
    prevChapter,
    nextChapter,
    onUpdateViewMode: (next) => update({ viewMode: next }),
    onSetTheme: setTheme,
    onBeginEditing: editor.beginEditing,
    onRequestCancelEditing: editor.requestCancelEditing,
    onSave: editor.handleSaveRequest,
    onGoToChapter: goToChapter,
    onSetShortcutsOpen: setShortcutsOpen,
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
    prevChapter,
    nextChapter,
    hasTranslation,
    aligned,
    rawParagraphs,
    translatedParagraphs,
    fontSizePx,
    readerFontClass,
    settings,
    update,
    isAdmin: !!user,
    editing: editor.editing,
    jobRunning,
    translationStatus,
    translationStatusError: activeJobsError,
    retryTranslationStatus: refetchActiveJobs,
    theme,
    setTheme,
    activeJob,
    panel,
    onPanelChange: setPanel,
    actionsOpen,
    onActionsOpenChange: setActionsOpen,
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
  };
}
