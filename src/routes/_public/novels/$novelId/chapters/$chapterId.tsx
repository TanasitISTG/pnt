import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  List,
  Pencil,
  RotateCw,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getChapter,
  getNovel,
  listChapters,
  updateChapterTranslation,
} from "@/lib/novel.functions";
import { getReaderProgress, markChapterRead, saveScrollPosition } from "@/lib/reader-progress";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { useTranslationJob } from "@/lib/translation/use-translation-job";
import { alignParagraphs, splitParagraphs } from "@/lib/translation/paragraphs";
import {
  READER_FONT_SIZE_PX,
  useReaderSettings,
  type ReaderFontSize,
  type ReaderTypeface,
  type ReaderViewMode,
} from "@/lib/reader-settings";
import { cn } from "@/lib/utils";
import { downloadText, sanitizeFilename } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const chapterQueryOptions = (chapterId: string) =>
  queryOptions({
    queryKey: ["chapter", chapterId],
    queryFn: () => getChapter({ data: { chapterId } }),
  });

const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId],
    queryFn: () => listChapters({ data: { novelId } }),
  });

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

export const Route = createFileRoute("/_public/novels/$novelId/chapters/$chapterId")({
  loader: async ({ params, context }) => {
    const [chapter, _chapters, novel] = await Promise.all([
      context.queryClient.ensureQueryData(chapterQueryOptions(params.chapterId)),
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
    ]);
    if (!chapter) {
      throw notFound();
    }
    return { chapter, novel };
  },
  head: ({ loaderData }) => {
    const chapter = loaderData?.chapter;
    const novel = loaderData?.novel;
    const chTitle = chapter
      ? `Ch. ${Number(chapter.number)} — ${chapter.translatedTitle ?? chapter.title}`
      : "Chapter";
    const novelTitle = novel?.title ?? "Novel";
    const pageTitle = `${chTitle} | ${novelTitle} | Pnt - Personal Novel Translator`;
    const description = novel?.description
      ? novel.description.length > 160
        ? `${novel.description.slice(0, 157)}...`
        : novel.description
      : "Read translated web novel chapter.";

    return {
      meta: [
        { title: pageTitle },
        { name: "description", content: description },
        { property: "og:title", content: pageTitle },
        { property: "og:description", content: description },
        { name: "twitter:title", content: pageTitle },
        { name: "twitter:description", content: description },
      ],
    };
  },
  component: ReaderPage,
});

const VIEW_MODES: { value: ReaderViewMode; label: string; icon: typeof Columns2 }[] = [
  { value: "side", label: "Side by side", icon: Columns2 },
  { value: "translated", label: "Translated", icon: BookOpen },
  { value: "raw", label: "Raw", icon: FileText },
];

function renderParagraph(
  text: string,
  key: React.Key,
  fontSizePx: number,
  readerFontClass?: string,
  dimmed = false,
) {
  return (
    <p
      key={key}
      className={cn(
        "whitespace-pre-wrap",
        dimmed ? "text-muted-foreground" : "text-foreground",
        readerFontClass,
      )}
      style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
    >
      {text}
    </p>
  );
}

interface ReaderContentProps {
  hasTranslation: boolean;
  viewMode: "side" | "translated" | "raw";
  aligned: { raw: string | null; translated: string | null }[];
  rawParagraphs: string[];
  translatedParagraphs: string[];
  fontSizePx: number;
  readerFontClass?: string;
  hydrated: boolean;
}

const ReaderContent = memo(function ReaderContent({
  hasTranslation,
  viewMode,
  aligned,
  rawParagraphs,
  translatedParagraphs,
  fontSizePx,
  readerFontClass,
  hydrated,
}: ReaderContentProps) {
  return (
    <div style={hydrated ? undefined : { visibility: "hidden" }}>
      {!hasTranslation ? (
        <div className="flex flex-col gap-8">
          <p className="text-caption text-muted-foreground italic">
            Not translated yet — showing raw text.
          </p>
          <div className="mx-auto flex max-w-prose flex-col gap-5">
            {rawParagraphs.map((p, i) => renderParagraph(p, i, fontSizePx, readerFontClass))}
          </div>
        </div>
      ) : viewMode === "side" ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          {aligned.map((pair, i) => (
            <div key={i} className="contents">
              <div>
                {pair.raw
                  ? renderParagraph(pair.raw, `r-${i}`, fontSizePx, readerFontClass, true)
                  : null}
              </div>
              <div className="border-b border-border pb-5 md:border-b-0 md:pb-0">
                {pair.translated
                  ? renderParagraph(pair.translated, `t-${i}`, fontSizePx, readerFontClass)
                  : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mx-auto flex max-w-prose flex-col gap-5">
          {(viewMode === "translated" ? translatedParagraphs : rawParagraphs).map((p, i) =>
            renderParagraph(p, i, fontSizePx, readerFontClass),
          )}
        </div>
      )}
    </div>
  );
});

function ReaderPage() {
  const { novelId, chapterId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: chapter,
    isError: isChapterError,
    error: chapterError,
    refetch: refetchChapter,
  } = useQuery(chapterQueryOptions(chapterId));
  const {
    data: chapters = [],
    isError: isChaptersError,
    error: chaptersError,
    refetch: refetchChapters,
  } = useQuery(chaptersQueryOptions(novelId));

  const restoredChapterRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);

  useEffect(() => {
    if (chapter?.id === chapterId) {
      markChapterRead(novelId, chapterId);
    }
  }, [novelId, chapterId, chapter?.id]);

  useEffect(() => {
    if (!chapter) return;
    if (restoredChapterRef.current === chapterId) return;

    const progress = getReaderProgress(novelId);
    if (
      progress.lastChapterId === chapterId &&
      typeof progress.scrollFraction === "number" &&
      progress.scrollFraction > 0.01
    ) {
      const fraction = progress.scrollFraction;
      isRestoringRef.current = true;

      // The router's scrollRestoration scrolls to top on push navigation and can
      // land AFTER our first scrollTo, wiping it out. Re-assert the target until
      // it survives a few consecutive frames; bail early if the user takes over.
      let frames = 0;
      let stableFrames = 0;
      let lastWritten = -1;

      const tryScroll = () => {
        frames++;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

        if (maxScroll > 50) {
          const target = maxScroll * fraction;
          const y = window.scrollY;

          if (lastWritten >= 0 && Math.abs(y - lastWritten) > 2 && y !== 0) {
            // User grabbed the scroll position — stop fighting.
            restoredChapterRef.current = chapterId;
            setTimeout(() => {
              isRestoringRef.current = false;
            }, 150);
            return;
          }

          if (lastWritten >= 0 && Math.abs(y - target) <= 2) {
            stableFrames++;
            if (stableFrames >= 3) {
              restoredChapterRef.current = chapterId;
              setTimeout(() => {
                isRestoringRef.current = false;
              }, 150);
              return;
            }
          } else {
            stableFrames = 0;
            window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
            lastWritten = target;
          }
        }

        if (frames < 90) {
          requestAnimationFrame(tryScroll);
        } else {
          restoredChapterRef.current = chapterId;
          isRestoringRef.current = false;
        }
      };

      requestAnimationFrame(tryScroll);
    } else {
      restoredChapterRef.current = chapterId;
      isRestoringRef.current = false;
    }
  }, [chapterId, novelId, chapter]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (isRestoringRef.current || restoredChapterRef.current !== chapterId) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (isRestoringRef.current || restoredChapterRef.current !== chapterId) return;
        const docHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        const maxScroll = docHeight - viewportHeight;
        if (maxScroll > 50) {
          const fraction = window.scrollY / maxScroll;
          if (fraction > 0.005) {
            saveScrollPosition(novelId, fraction);
          }
        }
      }, 300);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [novelId, chapterId]);

  const { settings, update, hydrated } = useReaderSettings();
  const { theme, setTheme } = useTheme();
  const viewMode = settings.viewMode;
  const [editValue, setEditValue] = useState<string | null>(null);
  const editing = editValue !== null;
  const [retranslateConfirmOpen, setRetranslateConfirmOpen] = useState(false);

  const { start: startTranslate, activeJobs } = useTranslationJob(novelId, !!user);
  const activeJob = activeJobs.get(chapterId);
  const jobRunning = activeJob?.status === "pending" || activeJob?.status === "running";

  const { prevChapter, nextChapter } = useMemo(() => {
    const idx = chapters.findIndex((c) => c.id === chapterId);
    return {
      prevChapter: idx > 0 ? chapters[idx - 1] : null,
      nextChapter: idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null,
    };
  }, [chapters, chapterId]);

  const goToChapter = (id: string) =>
    navigate({
      to: "/novels/$novelId/chapters/$chapterId",
      params: { novelId, chapterId: id },
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "ArrowLeft" && prevChapter) goToChapter(prevChapter.id);
      if (e.key === "ArrowRight" && nextChapter) goToChapter(nextChapter.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const prevJobStatus = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevJobStatus.current;
    const curr = activeJob?.status ?? null;
    prevJobStatus.current = curr;
    const wasRunning = prev === "pending" || prev === "running";
    const isIdle = curr !== "pending" && curr !== "running";
    if (wasRunning && isIdle) {
      queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    }
  }, [activeJob?.status, chapterId, novelId, queryClient]);

  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = editTextareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [editValue]);

  const { mutateAsync: saveTranslation, isPending: saving } = useMutation({
    mutationFn: (translatedContent: string) =>
      updateChapterTranslation({ data: { chapterId, translatedContent } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] });
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success("Translation saved");
      setEditValue(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save translation");
    },
  });

  const aligned = useMemo(
    () =>
      chapter?.translatedContent
        ? alignParagraphs(chapter.rawContent, chapter.translatedContent)
        : [],
    [chapter],
  );
  const rawParagraphs = useMemo(
    () => (chapter ? splitParagraphs(chapter.rawContent) : []),
    [chapter],
  );
  const translatedParagraphs = useMemo(
    () => (chapter?.translatedContent ? splitParagraphs(chapter.translatedContent) : []),
    [chapter],
  );

  if (isChapterError || isChaptersError) {
    return (
      <QueryErrorState
        title="Failed to load chapter"
        error={chapterError || chaptersError}
        onRetry={() => {
          refetchChapter();
          refetchChapters();
        }}
        className="min-h-[40vh] my-12"
      />
    );
  }

  if (!chapter) {
    throw notFound();
  }

  const hasTranslation = !!chapter.translatedContent;
  const fontSizePx = READER_FONT_SIZE_PX[settings.fontSize];
  const readerFontClass = settings.typeface === "reader" ? "font-reader" : undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar */}
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

          <Select value={chapterId} onValueChange={(id) => goToChapter(id as string)}>
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
              onClick={() => prevChapter && goToChapter(prevChapter.id)}
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
              onClick={() => nextChapter && goToChapter(nextChapter.id)}
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

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="size-8" />}
              aria-label="Reading settings"
              title="Reading settings"
            >
              <Settings2 className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Font size</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={settings.fontSize}
                  onValueChange={(v) => update({ fontSize: v as ReaderFontSize })}
                >
                  {(["S", "M", "L", "XL"] as const).map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {s}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Typeface</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={settings.typeface}
                  onValueChange={(v) => update({ typeface: v as ReaderTypeface })}
                >
                  <DropdownMenuRadioItem value="default">Sofia Sans</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="reader">Sarabun</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {user && hasTranslation && !editing && !jobRunning && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditValue(chapter.translatedContent ?? "")}
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

          {user &&
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
                  onClick={() => {
                    if (chapter.editedAt) {
                      setRetranslateConfirmOpen(true);
                    } else {
                      startTranslate(chapterId);
                    }
                  }}
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

      {/* Title row */}
      <div className="flex items-baseline gap-3 border-b border-border pb-4">
        <span className="text-caption text-muted-foreground font-mono">
          Ch. {Number(chapter.number)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-card-title font-semibold text-foreground tracking-tight">
            {chapter.translatedTitle ?? chapter.title}
          </h1>
          {chapter.translatedTitle && chapter.translatedTitle !== chapter.title && (
            <span className="text-caption text-muted-foreground">{chapter.title}</span>
          )}
        </div>
        {chapter.editedAt && (
          <Badge variant="secondary" className="text-[10px]">
            Edited
          </Badge>
        )}
      </div>

      {/* Content */}
      {editing ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <span className="text-caption font-semibold text-muted-foreground uppercase">
                Raw
              </span>
              {rawParagraphs.map((p, i) =>
                renderParagraph(p, i, fontSizePx, readerFontClass, true),
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-caption font-semibold text-muted-foreground uppercase">
                Translation
              </span>
              <Textarea
                ref={editTextareaRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className={cn("min-h-64 resize-none overflow-hidden", readerFontClass)}
                style={{ fontSize: fontSizePx, lineHeight: 1.75 }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <Button variant="outline" onClick={() => setEditValue(null)} disabled={saving}>
              <X className="size-4" />
              Cancel
            </Button>
            <Button
              onClick={() => saveTranslation(editValue)}
              disabled={saving || editValue.trim().length === 0}
            >
              <Check className="size-4" />
              {saving ? "Saving..." : "Save Translation"}
            </Button>
          </div>
        </div>
      ) : (
        <ReaderContent
          hasTranslation={hasTranslation}
          viewMode={viewMode}
          aligned={aligned}
          rawParagraphs={rawParagraphs}
          translatedParagraphs={translatedParagraphs}
          fontSizePx={fontSizePx}
          readerFontClass={readerFontClass}
          hydrated={hydrated}
        />
      )}

      {/* Bottom navigation */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        {prevChapter ? (
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 max-w-32 sm:max-w-64"
            onClick={() => goToChapter(prevChapter.id)}
            title={`Ch. ${Number(prevChapter.number)} — ${prevChapter.translatedTitle ?? prevChapter.title}`}
          >
            <ChevronLeft className="size-4 shrink-0" />
            <span className="truncate">
              {`Ch. ${Number(prevChapter.number)} — ${prevChapter.translatedTitle ?? prevChapter.title}`}
            </span>
          </Button>
        ) : (
          <span />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          render={<Link to="/novels/$novelId" params={{ novelId }} />}
          aria-label="All chapters"
          title="All chapters"
        >
          <List className="size-4 sm:hidden" />
          <span className="hidden sm:inline">All chapters</span>
        </Button>
        {nextChapter ? (
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 max-w-32 sm:max-w-64"
            onClick={() => goToChapter(nextChapter.id)}
            title={`Ch. ${Number(nextChapter.number)} — ${nextChapter.translatedTitle ?? nextChapter.title}`}
          >
            <span className="truncate">
              {`Ch. ${Number(nextChapter.number)} — ${nextChapter.translatedTitle ?? nextChapter.title}`}
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </Button>
        ) : (
          <span />
        )}
      </div>

      <ConfirmDialog
        open={retranslateConfirmOpen}
        onOpenChange={setRetranslateConfirmOpen}
        title="Overwrite Edited Translation?"
        description="This chapter was manually edited. Re-translating will overwrite your manual changes with a new machine translation."
        confirmText="Overwrite & Translate"
        onConfirm={() => {
          setRetranslateConfirmOpen(false);
          startTranslate(chapterId);
        }}
      />
    </div>
  );
}
