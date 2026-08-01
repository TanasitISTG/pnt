import { createFileRoute, notFound } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { getNovel } from "@/lib/novel.functions";
import { getChapter, listChapters, updateChapterTranslation } from "@/lib/chapter.functions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { useTranslationJob } from "@/lib/translation/use-translation-job";
import { alignParagraphs, splitParagraphs } from "@/lib/translation/paragraphs";
import { READER_FONT_SIZE_PX, useReaderSettings } from "@/lib/reader-settings";
import { ReaderContent } from "@/components/reader/chapter-content";
import { ChapterTitleRow } from "@/components/reader/chapter-title-row";
import { ReaderFooterNav } from "@/components/reader/reader-footer-nav";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { TranslationEditor } from "@/components/reader/translation-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChapterNav } from "@/components/reader/use-chapter-nav";
import { useReaderScroll } from "@/components/reader/use-reader-scroll";

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

function ReaderPage() {
  const { novelId, chapterId } = Route.useParams();
  const { user } = Route.useRouteContext();
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
  const { data: novel } = useQuery(novelQueryOptions(novelId));

  useReaderScroll(novelId, chapterId, chapter);

  const { settings, update, hydrated } = useReaderSettings();
  const { theme, setTheme } = useTheme();
  const viewMode = settings.viewMode;
  const [editValue, setEditValue] = useState<string | null>(null);
  const editing = editValue !== null;
  const [retranslateConfirmOpen, setRetranslateConfirmOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const { start: startTranslate, activeJobs } = useTranslationJob(novelId, !!user);
  const activeJob = activeJobs.get(chapterId);
  const jobRunning = activeJob?.status === "pending" || activeJob?.status === "running";

  const { prevChapter, nextChapter, goToChapter } = useChapterNav(novelId, chapterId, chapters);

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

  const cycleViewMode = () => {
    const next = viewMode === "side" ? "translated" : viewMode === "translated" ? "raw" : "side";
    update({ viewMode: next });
  };
  useHotkey("ArrowLeft", () => prevChapter && goToChapter(prevChapter.id), {
    enabled: !!prevChapter,
  });
  useHotkey("H", () => prevChapter && goToChapter(prevChapter.id), { enabled: !!prevChapter });
  useHotkey("ArrowRight", () => nextChapter && goToChapter(nextChapter.id), {
    enabled: !!nextChapter,
  });
  useHotkey("L", () => nextChapter && goToChapter(nextChapter.id), { enabled: !!nextChapter });
  useHotkey("V", cycleViewMode);
  useHotkey("T", () => setTheme(theme === "dark" ? "light" : "dark"));
  useHotkey("E", () => setEditValue(chapter?.translatedContent ?? ""), {
    enabled: !!user && !editing && !!chapter,
  });
  useHotkey("Escape", () => (editing ? setEditValue(null) : setShortcutsOpen(false)), {
    enabled: editing || shortcutsOpen,
  });
  useHotkey("Mod+S", () => editValue !== null && saveTranslation(editValue), {
    enabled: editing && !!user,
    preventDefault: true,
  });
  useHotkey("/", () => setShortcutsOpen(true));

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
      <ReaderToolbar
        novelId={novelId}
        chapterId={chapterId}
        chapter={chapter}
        chapters={chapters}
        prevChapter={prevChapter}
        nextChapter={nextChapter}
        hasTranslation={hasTranslation}
        viewMode={viewMode}
        settings={settings}
        update={update}
        theme={theme}
        setTheme={setTheme}
        isAdmin={!!user}
        editing={editing}
        jobRunning={jobRunning}
        activeJob={activeJob}
        onGoToChapter={goToChapter}
        onEditRequest={() => setEditValue(chapter.translatedContent ?? "")}
        onTranslateRequest={() => {
          if (chapter.editedAt) {
            setRetranslateConfirmOpen(true);
          } else {
            startTranslate(chapterId);
          }
        }}
      />

      <ChapterTitleRow
        number={chapter.number}
        title={chapter.title}
        translatedTitle={chapter.translatedTitle}
        editedAt={chapter.editedAt}
      />

      {editing ? (
        <TranslationEditor
          rawParagraphs={rawParagraphs}
          editValue={editValue}
          onEditValueChange={setEditValue}
          fontSizePx={fontSizePx}
          readerFontClass={readerFontClass}
          saving={saving}
          onSave={() => saveTranslation(editValue)}
          onCancel={() => setEditValue(null)}
        />
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
          sourceLang={novel?.sourceLang}
          targetLang={novel?.targetLang}
        />
      )}

      <ReaderFooterNav
        novelId={novelId}
        prevChapter={prevChapter}
        nextChapter={nextChapter}
        onGoToChapter={goToChapter}
      />

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

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reader shortcuts</DialogTitle>
            <DialogDescription>
              Keyboard controls work when focus is outside form fields.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-caption">
            <ShortcutKeys keys="← / h" label="Previous chapter" />
            <ShortcutKeys keys="→ / l" label="Next chapter" />
            <ShortcutKeys keys="v" label="Cycle view mode" />
            <ShortcutKeys keys="t" label="Toggle theme" />
            {user && <ShortcutKeys keys="e" label="Edit translation" />}
            {user && <ShortcutKeys keys="Ctrl/⌘+S" label="Save edit" />}
            <ShortcutKeys keys="Esc" label="Cancel edit or close help" />
            <ShortcutKeys keys="/" label="Show this help" />
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShortcutKeys({ keys, label }: { keys: string; label: string }) {
  return (
    <>
      <dt>
        <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-semibold text-foreground">
          {keys}
        </kbd>
      </dt>
      <dd className="text-muted-foreground">{label}</dd>
    </>
  );
}
