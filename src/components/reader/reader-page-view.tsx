import type { ActiveJobState } from "@/lib/translation/types/api";
import type { ReaderSettings } from "@/lib/reader/types";
import { ReaderContent } from "./chapter-content";
import { ChapterEditor, type ChapterDraft } from "./chapter-editor";
import { ChapterTitleRow } from "./chapter-title-row";
import { ReaderDialogs } from "./reader-dialogs";
import type { ReaderChapterSummary } from "./reader-toolbar";
import { ReaderToolbar } from "./reader-toolbar";
import { ReaderFooterNav } from "./reader-footer-nav";

export interface ReaderChapterData extends ReaderChapterSummary {
  novelId: string;
  rawContent: string;
  translatedContent: string | null;
  editedAt: Date | string | null;
  status: string;
}

export interface ReaderNovelData {
  id: string;
  title: string;
  sourceLang: string;
  targetLang: string;
}

export interface ReaderPageViewProps {
  novelId: string;
  novel: ReaderNovelData;
  chapterId: string;
  chapter: ReaderChapterData;
  chapters: ReaderChapterSummary[];
  prevChapter: ReaderChapterSummary | null;
  nextChapter: ReaderChapterSummary | null;
  hasTranslation: boolean;
  aligned: { raw?: string | null; translated?: string | null }[];
  rawParagraphs: string[];
  translatedParagraphs: string[];
  fontSizePx: number;
  readerFontClass?: string;
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
  retranslateConfirmOpen: boolean;
  onRetranslateConfirmChange: (open: boolean) => void;
  onConfirmRetranslate: () => void;
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (open: boolean) => void;
  discardDialogOpen: boolean;
  blockerStatus: string;
  onDiscardDialogChange: (open: boolean) => void;
  onKeepEditing: () => void;
  onDiscardChanges: () => void;
  sourcePolicyDialogOpen: boolean;
  saving: boolean;
  onSourcePolicyChange: (open: boolean) => void;
  onClearTranslation: () => void;
  onKeepTranslation: () => void;
  draft: ChapterDraft | null;
  editErrors: Record<string, string>;
  updateDraft: (field: keyof ChapterDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ReaderPageView({
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
  retranslateConfirmOpen,
  onRetranslateConfirmChange,
  onConfirmRetranslate,
  shortcutsOpen,
  onShortcutsOpenChange,
  discardDialogOpen,
  blockerStatus,
  onDiscardDialogChange,
  onKeepEditing,
  onDiscardChanges,
  sourcePolicyDialogOpen,
  saving,
  onSourcePolicyChange,
  onClearTranslation,
  onKeepTranslation,
  draft,
  editErrors,
  updateDraft,
  onSave,
  onCancel,
}: ReaderPageViewProps) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-8">
      <ReaderToolbar
        novelId={novelId}
        novelTitle={novel.title}
        chapterId={chapterId}
        chapter={chapter}
        chapters={chapters}
        prevChapter={prevChapter}
        nextChapter={nextChapter}
        hasTranslation={hasTranslation}
        settings={settings}
        update={update}
        theme={theme}
        setTheme={setTheme}
        isAdmin={isAdmin}
        editing={editing}
        jobRunning={jobRunning}
        activeJob={activeJob}
        panel={panel}
        onPanelChange={onPanelChange}
        actionsOpen={actionsOpen}
        onActionsOpenChange={onActionsOpenChange}
        onGoToChapter={onGoToChapter}
        onEditRequest={onEditRequest}
        onTranslateRequest={onTranslateRequest}
        onShortcutsRequest={onShortcutsRequest}
      />

      <ChapterTitleRow
        number={chapter.number}
        title={chapter.title}
        translatedTitle={chapter.translatedTitle}
        editedAt={chapter.editedAt}
      />

      {editing && draft ? (
        <ChapterEditor
          draft={draft}
          errors={editErrors}
          fontSizePx={fontSizePx}
          readerFontClass={readerFontClass}
          saving={saving}
          onChange={updateDraft}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : (
        <div className="min-w-0 max-w-full">
          <ReaderContent
            hasTranslation={hasTranslation}
            viewMode={settings.viewMode}
            aligned={aligned}
            rawParagraphs={rawParagraphs}
            translatedParagraphs={translatedParagraphs}
            fontSizePx={fontSizePx}
            readerFontClass={readerFontClass}
            sourceLang={novel.sourceLang}
            targetLang={novel.targetLang}
          />
        </div>
      )}

      <ReaderFooterNav
        novelId={novelId}
        prevChapter={prevChapter}
        nextChapter={nextChapter}
        onGoToChapter={onGoToChapter}
      />

      <ReaderDialogs
        translation={{
          open: retranslateConfirmOpen,
          onOpenChange: onRetranslateConfirmChange,
          onConfirm: onConfirmRetranslate,
        }}
        sourceEdit={{
          open: sourcePolicyDialogOpen,
          saving,
          onOpenChange: onSourcePolicyChange,
          onClear: onClearTranslation,
          onKeep: onKeepTranslation,
        }}
        discard={{
          open: discardDialogOpen || blockerStatus === "blocked",
          onOpenChange: onDiscardDialogChange,
          onKeep: onKeepEditing,
          onDiscard: onDiscardChanges,
        }}
        shortcuts={{
          open: shortcutsOpen,
          onOpenChange: onShortcutsOpenChange,
          canEdit: isAdmin,
        }}
      />
    </div>
  );
}
