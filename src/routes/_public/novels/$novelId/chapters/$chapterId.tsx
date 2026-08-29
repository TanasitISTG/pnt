import { createFileRoute, notFound, useBlocker } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import sarabunThaiUrl from "@fontsource/sarabun/files/sarabun-thai-400-normal.woff2?url";

import { getNovel } from "@/lib/content/novel.functions";
import { getChapter, listChapters, updateChapter } from "@/lib/content/chapter.functions";
import { editChapterSchema, type EditChapterInput } from "@/lib/content/novel.schemas";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { useTranslationJob } from "@/components/translation/use-translation-job";
import { alignParagraphs, splitParagraphs } from "@/lib/translation/text/paragraphs";
import { READER_FONT_SIZE_PX, useReaderSettings } from "@/lib/reader/settings";
import { ReaderContent } from "@/components/reader/chapter-content";
import { ChapterTitleRow } from "@/components/reader/chapter-title-row";
import { ReaderFooterNav } from "@/components/reader/reader-footer-nav";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";
import { ChapterEditor, type ChapterDraft } from "@/components/reader/chapter-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
      links: [
        {
          rel: "preload",
          as: "font",
          type: "font/woff2",
          href: sarabunThaiUrl,
          crossOrigin: "anonymous",
        },
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

  const { settings, update } = useReaderSettings();
  const { theme, setTheme } = useTheme();
  const viewMode = settings.viewMode;
  const [draft, setDraft] = useState<ChapterDraft | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [sourcePolicyDialogOpen, setSourcePolicyDialogOpen] = useState(false);
  const editing = draft !== null;
  const [retranslateConfirmOpen, setRetranslateConfirmOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const { start: startTranslate, activeJobs } = useTranslationJob(novelId, !!user);
  const activeJob = activeJobs.get(chapterId);
  const jobRunning =
    activeJob?.status === "pending" ||
    activeJob?.status === "running" ||
    chapter?.status === "queued" ||
    chapter?.status === "translating";

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

  const { mutateAsync: saveChapter, isPending: saving } = useMutation({
    mutationFn: (payload: EditChapterInput) => updateChapter({ data: payload }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] }),
        queryClient.invalidateQueries({ queryKey: ["chapters", novelId] }),
      ]);
      setDraft(null);
      setEditErrors({});
      setSourcePolicyDialogOpen(false);
      toast.success("Chapter saved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save chapter");
    },
  });

  const sourceChanged =
    !!draft &&
    !!chapter &&
    (draft.title !== chapter.title || draft.rawContent !== chapter.rawContent);
  const isDirty =
    !!draft &&
    !!chapter &&
    (sourceChanged ||
      draft.translatedTitle !== (chapter.translatedTitle ?? "") ||
      draft.translatedContent !== (chapter.translatedContent ?? ""));

  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    withResolver: true,
    enableBeforeUnload: isDirty,
  });

  const clearEditErrors = (field: string) => {
    setEditErrors((current) => ({ ...current, [field]: "" }));
  };

  const beginEditing = () => {
    if (!chapter || !user || jobRunning) return;
    setDraft({
      title: chapter.title,
      translatedTitle: chapter.translatedTitle ?? "",
      rawContent: chapter.rawContent,
      translatedContent: chapter.translatedContent ?? "",
    });
    setEditErrors({});
  };

  const updateDraft = (field: keyof ChapterDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    clearEditErrors(field);
  };

  const closeEditor = () => {
    setDraft(null);
    setEditErrors({});
    setSourcePolicyDialogOpen(false);
  };

  const requestCancelEditing = () => {
    if (!editing) return;
    if (isDirty) {
      setDiscardDialogOpen(true);
    } else {
      closeEditor();
    }
  };

  const setSchemaErrors = (issues: Array<{ path: PropertyKey[]; message: string }>) => {
    const fieldErrors: Record<string, string> = {};
    for (const issue of issues) {
      if (issue.path[0] !== undefined) fieldErrors[String(issue.path[0])] = issue.message;
    }
    setEditErrors(fieldErrors);
  };

  const buildPayload = (policy?: "keep" | "clear"): EditChapterInput | null => {
    if (!draft || !chapter) return null;

    if (
      policy !== "clear" &&
      chapter.translatedContent !== null &&
      draft.translatedContent.trim().length === 0
    ) {
      setEditErrors({
        translatedContent: "Translation cannot be empty. Choose Clear Translation to remove it.",
      });
      return null;
    }

    const translatedContentChanged = draft.translatedContent !== (chapter.translatedContent ?? "");
    const translatedContent =
      policy === "clear" && sourceChanged
        ? { translatedContent: null }
        : translatedContentChanged && draft.translatedContent.trim().length > 0
          ? { translatedContent: draft.translatedContent }
          : {};
    const payload = {
      chapterId,
      title: draft.title,
      translatedTitle: draft.translatedTitle.trim().length ? draft.translatedTitle : null,
      rawContent: draft.rawContent,
      ...translatedContent,
      ...(sourceChanged && policy ? { sourceChangePolicy: policy } : {}),
    } satisfies EditChapterInput;
    const result = editChapterSchema.safeParse(payload);
    if (!result.success) {
      setSchemaErrors(result.error.issues);
      return null;
    }
    return result.data;
  };

  const persistDraft = async (policy?: "keep" | "clear") => {
    const payload = buildPayload(policy);
    if (!payload) return;
    await saveChapter(payload).catch(() => {});
  };

  const handleSaveRequest = () => {
    if (!draft || !chapter) return;
    setEditErrors({});

    const fieldsResult = editChapterSchema.safeParse({
      chapterId,
      title: draft.title,
      translatedTitle: draft.translatedTitle.trim().length ? draft.translatedTitle : null,
      rawContent: draft.rawContent,
    });
    if (!fieldsResult.success) {
      setSchemaErrors(fieldsResult.error.issues);
      return;
    }

    if (sourceChanged) {
      const hasTranslation = Boolean(
        chapter.translatedTitle ||
        chapter.translatedContent ||
        draft.translatedTitle.trim() ||
        draft.translatedContent.trim(),
      );
      if (hasTranslation) {
        setSourcePolicyDialogOpen(true);
        return;
      }
      void persistDraft("clear");
      return;
    }

    void persistDraft();
  };
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
  useHotkey("E", beginEditing, {
    enabled: !!user && !editing && !!chapter && !jobRunning,
  });
  useHotkey("Escape", () => (editing ? requestCancelEditing() : setShortcutsOpen(false)), {
    enabled: editing || shortcutsOpen,
  });
  useHotkey(
    "Mod+S",
    () => {
      void handleSaveRequest();
    },
    {
      enabled: editing && !!user,
      preventDefault: true,
    },
  );
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
        onEditRequest={beginEditing}
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

      {editing && draft ? (
        <ChapterEditor
          draft={draft}
          errors={editErrors}
          fontSizePx={fontSizePx}
          readerFontClass={readerFontClass}
          saving={saving}
          onChange={updateDraft}
          onSave={handleSaveRequest}
          onCancel={requestCancelEditing}
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
      <Dialog open={sourcePolicyDialogOpen} onOpenChange={setSourcePolicyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Source Changed</DialogTitle>
            <DialogDescription>
              Keeping the translation marks it as manually edited. Clearing removes the translated
              title and content so the chapter can be retranslated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSourcePolicyDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void persistDraft("clear")}
              disabled={saving}
            >
              Clear Translation
            </Button>
            <Button onClick={() => void persistDraft("keep")} disabled={saving}>
              Keep Translation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={discardDialogOpen || blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (open) return;
          setDiscardDialogOpen(false);
          if (blocker.status === "blocked") blocker.reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard Unsaved Changes?</DialogTitle>
            <DialogDescription>
              Your chapter edits are not saved. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDiscardDialogOpen(false);
                if (blocker.status === "blocked") blocker.reset();
              }}
            >
              Keep Editing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const wasBlocked = blocker.status === "blocked";
                closeEditor();
                setDiscardDialogOpen(false);
                if (wasBlocked) blocker.proceed();
              }}
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {user && <ShortcutKeys keys="e" label="Edit chapter" />}
            {user && <ShortcutKeys keys="Ctrl/⌘+S" label="Save chapter" />}
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
