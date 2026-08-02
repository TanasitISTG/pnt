import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  Pencil,
  RotateCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadText, sanitizeFilename } from "@/lib/download";
import type { ReaderSettings, ReaderViewMode } from "@/lib/reader/types";
import type { ActiveJobState } from "@/lib/translation/translation.types";
import { cn } from "@/lib/utils";
import { ReaderSettingsPanel } from "./reader-settings-panel";

// Row shape the toolbar needs — listChapters rows are a structural superset.
export interface ReaderChapterSummary {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
}

export interface ReaderToolbarProps {
  novelId: string;
  chapterId: string;
  chapter: ReaderChapterSummary & {
    translatedContent: string | null;
    editedAt: Date | string | null;
  };
  chapters: ReaderChapterSummary[];
  prevChapter: ReaderChapterSummary | null;
  nextChapter: ReaderChapterSummary | null;
  hasTranslation: boolean;
  viewMode: ReaderViewMode;
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  theme: string | undefined;
  setTheme: (theme: string) => void;
  isAdmin: boolean;
  editing: boolean;
  jobRunning: boolean;
  activeJob: ActiveJobState | undefined;
  onGoToChapter: (id: string) => void;
  onEditRequest: () => void;
  onTranslateRequest: () => void;
}

const VIEW_MODES: { value: ReaderViewMode; label: string; icon: typeof Columns2 }[] = [
  { value: "side", label: "Side by side", icon: Columns2 },
  { value: "translated", label: "Translated", icon: BookOpen },
  { value: "raw", label: "Raw", icon: FileText },
];

export function ReaderToolbar({
  novelId,
  chapterId,
  chapter,
  chapters,
  prevChapter,
  nextChapter,
  hasTranslation,
  viewMode,
  settings,
  update,
  theme,
  setTheme,
  isAdmin,
  editing,
  jobRunning,
  activeJob,
  onGoToChapter,
  onEditRequest,
  onTranslateRequest,
}: ReaderToolbarProps) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      {/* Navigation Group */}
      <div className="flex items-center gap-1.5 w-full sm:w-auto sm:flex-1 sm:max-w-xl">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          render={<Link to="/novels/$novelId" params={{ novelId }} />}
          aria-label="Back to chapter list"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <Select value={chapterId} onValueChange={(id) => onGoToChapter(id as string)}>
          <SelectTrigger className="min-w-0 flex-1 sm:max-w-md">
            <SelectValue>
              {`Ch. ${Number(chapter.number)} — ${chapter.translatedTitle ?? chapter.title}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {chapters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {`Ch. ${Number(c.number)} — ${c.translatedTitle ?? c.title}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!prevChapter}
            onClick={() => prevChapter && onGoToChapter(prevChapter.id)}
            aria-label="Previous chapter"
            title="Previous chapter (←)"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!nextChapter}
            onClick={() => nextChapter && onGoToChapter(nextChapter.id)}
            aria-label="Next chapter"
            title="Next chapter (→)"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Reader Controls Group */}
      <div className="flex items-center justify-end gap-2 w-full sm:w-auto sm:ml-auto shrink-0">
        {hasTranslation && !editing && (
          <div
            className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5"
            role="group"
            aria-label="View mode"
          >
            {VIEW_MODES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ viewMode: value })}
                aria-pressed={viewMode === value}
                title={label}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
                  viewMode === value
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        )}

        <ReaderSettingsPanel
          settings={settings}
          update={update}
          theme={theme}
          setTheme={setTheme}
        />

        {isAdmin && hasTranslation && !editing && !jobRunning && (
          <Button
            variant="outline"
            size="sm"
            onClick={onEditRequest}
            aria-label="Edit translation"
            title="Edit translation"
          >
            <Pencil className="size-4" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        )}

        {hasTranslation && !editing && !jobRunning && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadText(
                `${sanitizeFilename(`ch-${Number(chapter.number)}-${chapter.translatedTitle ?? chapter.title}`)}.txt`,
                chapter.translatedContent ?? "",
              )
            }
            aria-label="Export chapter as .txt"
            title="Export chapter as .txt"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">.txt</span>
          </Button>
        )}

        {isAdmin &&
          (jobRunning && activeJob ? (
            <div className="flex min-w-36 flex-col gap-1">
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>Translating...</span>
                <span>
                  {activeJob.doneChunks}/{activeJob.totalChunks}
                </span>
              </div>
              <Progress
                value={
                  activeJob.totalChunks > 0
                    ? Math.round((activeJob.doneChunks / activeJob.totalChunks) * 100)
                    : 0
                }
                className="h-1.5"
              />
            </div>
          ) : (
            !editing && (
              <Button
                variant={hasTranslation ? "outline" : "default"}
                size="sm"
                onClick={onTranslateRequest}
                aria-label={hasTranslation ? "Re-translate chapter" : "Translate chapter"}
                title={hasTranslation ? "Re-translate chapter" : "Translate chapter"}
              >
                <RotateCw className="size-4" />
                <span className="hidden sm:inline">
                  {hasTranslation ? "Re-translate" : "Translate"}
                </span>
              </Button>
            )
          ))}
      </div>
    </div>
  );
}
