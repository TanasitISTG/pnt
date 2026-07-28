import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Edit,
  Trash2,
  FileText,
  X,
  Check,
  Play,
  BookOpen,
  Download,
  FileType,
  Languages,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { NovelCover } from "@/components/novel-cover";
import { ChapterTable, type ChapterRow } from "@/components/chapter-table";
import { AddChapterSection } from "@/components/add-chapter-section";
import { useTranslationJob } from "@/lib/translation/use-translation-job";
import { JobLogsDialog } from "@/components/job-logs-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { getReaderProgress } from "@/lib/reader-progress";
import type { ReaderProgress } from "@/lib/reader.types";

import {
  getNovel,
  getChapter,
  deleteNovel,
  listChapters,
  deleteChapter,
  updateChapterRaw,
  translateMissingTitles,
  setChapterPublished,
  setAllChaptersPublished,
  getResidualHanziChapters,
} from "@/lib/novel.functions";
import { getGlossaryStats } from "@/lib/glossary.functions";
import { getNovelCosts } from "@/lib/translation/translation.functions";
import { exportNovelEpub, exportNovelTxt } from "@/lib/export.functions";
import { downloadBase64, downloadText } from "@/lib/download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "@/components/ui/accordion";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { updateChapterSchema, type UpdateChapterInput } from "@/lib/novel.schemas";
import { formatCost, formatTokens } from "@/lib/utils";

const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId],
    queryFn: () => listChapters({ data: { novelId } }),
  });

const glossaryStatsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["glossaryStats", novelId],
    queryFn: () => getGlossaryStats({ data: { novelId } }),
  });

const costsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["costs", novelId],
    queryFn: () => getNovelCosts({ data: { novelId } }),
  });

const residualHanziQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["residualHanzi", novelId],
    queryFn: () => getResidualHanziChapters({ data: { novelId } }),
  });

const CHAPTER_GROUP_SIZE = 50;

export const Route = createFileRoute("/_public/novels/$novelId/")({
  loader: async ({ params, context }) => {
    const novelPromise = context.queryClient.ensureQueryData(novelQueryOptions(params.novelId));
    const tasks: Promise<unknown>[] = [
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
      ...(context.user
        ? [
            context.queryClient.ensureQueryData(glossaryStatsQueryOptions(params.novelId)),
            context.queryClient.ensureQueryData(costsQueryOptions(params.novelId)),
          ]
        : []),
    ];
    const [novel] = await Promise.all([novelPromise, ...tasks]);
    if (!novel) {
      throw notFound();
    }
    return { novel };
  },
  head: ({ loaderData }) => {
    const novel = loaderData?.novel;
    const title = novel
      ? `${novel.title} | Pnt - Personal Novel Translator`
      : "Novel Detail | Pnt - Personal Novel Translator";
    const description = novel?.description
      ? novel.description.length > 160
        ? `${novel.description.slice(0, 157)}...`
        : novel.description
      : "Read translated web novel chapters.";
    const appUrl = import.meta.env.VITE_APP_URL;
    const coverUrl = novel?.hasCover ? `${appUrl ?? ""}/api/covers/${novel.id}` : undefined;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(coverUrl ? [{ property: "og:image", content: coverUrl }] : []),
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(coverUrl ? [{ name: "twitter:image", content: coverUrl }] : []),
      ],
    };
  },
  component: NovelDetailPage,
});

interface EditState {
  chapterId: string;
  number: string;
  title: string;
  rawContent: string;
  contentLoading: boolean;
}

function NovelDetailPage() {
  const { novelId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: novel,
    isError: isNovelError,
    error: novelError,
    refetch: refetchNovel,
  } = useQuery(novelQueryOptions(novelId));
  const {
    data: chapters = [],
    isError: isChaptersError,
    error: chaptersError,
    refetch: refetchChapters,
  } = useQuery(chaptersQueryOptions(novelId));
  const { data: glossaryStats } = useQuery({
    ...glossaryStatsQueryOptions(novelId),
    enabled: !!user,
  });
  const { data: costData } = useQuery({ ...costsQueryOptions(novelId), enabled: !!user });
  const { data: residualHanziChapters = [] } = useQuery({
    ...residualHanziQueryOptions(novelId),
    enabled: !!user,
  });

  const residualHanziMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of residualHanziChapters) {
      map.set(item.chapterId, item.count);
    }
    return map;
  }, [residualHanziChapters]);

  const [readerProgress, setReaderProgress] = useState<ReaderProgress>({
    lastChapterId: null,
    readChapterIds: [],
  });
  const [retranslateChapterId, setRetranslateChapterId] = useState<string | null>(null);

  useEffect(() => {
    setReaderProgress(getReaderProgress(novelId));
  }, [novelId]);

  const lastReadChapter = useMemo(() => {
    if (!readerProgress.lastChapterId) return null;
    return chapters.find((c) => c.id === readerProgress.lastChapterId) ?? null;
  }, [chapters, readerProgress.lastChapterId]);

  const firstChapter = chapters[0] ?? null;

  const {
    start: startTranslate,
    startMany: startBatchTranslate,
    cancel: cancelTranslate,
    retry: retryTranslate,
    activeJobs,
  } = useTranslationJob(novelId, !!user);

  // Batch translate selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchRangeFrom, setBatchRangeFrom] = useState("");
  const [batchRangeTo, setBatchRangeTo] = useState("");

  const isRowTranslating = (chapterId: string, status: string) => {
    const job = activeJobs.get(chapterId);
    return (
      job?.status === "running" ||
      job?.status === "pending" ||
      status === "translating" ||
      status === "queued"
    );
  };

  const selectableIds = chapters.flatMap((c) => (isRowTranslating(c.id, c.status) ? [] : [c.id]));
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: string, checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleSelectAll = (checked: boolean) =>
    setSelectedIds(checked ? new Set(selectableIds) : new Set());

  const selectByRange = () => {
    const from = Number(batchRangeFrom);
    const to = Number(batchRangeTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || from > to) {
      toast.error("Enter a valid range (from ≥ 1, from ≤ to)");
      return;
    }
    const inRange = chapters.filter((c) => {
      const num = Number(c.number);
      return num >= from && num <= to && !isRowTranslating(c.id, c.status);
    });
    if (inRange.length === 0) {
      toast.info("No eligible chapters in that range");
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of inRange) next.add(c.id);
      return next;
    });
    toast.info(`Selected ${inRange.length} chapter(s) in range ${from}–${to}`);
  };

  const handleBatchTranslate = async () => {
    setBatchStarting(true);
    try {
      const count = await startBatchTranslate([...selectedIds]);
      if (count > 0) setSelectedIds(new Set());
    } finally {
      setBatchStarting(false);
    }
  };

  // Dialog States
  const [deleteNovelOpen, setDeleteNovelOpen] = useState(false);
  const [deleteChapterId, setDeleteChapterId] = useState<string | null>(null);
  const [logChapterId, setLogChapterId] = useState<string | null>(null);

  // Chapter edit state
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const invalidateChapters = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
  }, [queryClient, novelId]);

  const { mutateAsync: removeNovel, isPending: deletingNovel } = useMutation({
    mutationFn: () => deleteNovel({ data: { novelId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Novel deleted successfully");
      navigate({ to: "/" });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete novel");
    },
  });

  const { mutateAsync: removeChapter, isPending: deletingChapter } = useMutation({
    mutationFn: (vars: { chapterId: string }) => deleteChapter({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Chapter deleted successfully");
      setDeleteChapterId(null);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete chapter");
    },
  });

  const { mutate: publishChapter, isPending: publishingChapter } = useMutation({
    mutationFn: (vars: { chapterId: string; publishedAt: Date | null }) =>
      setChapterPublished({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success("Publish state updated");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update publish state");
    },
  });

  const { mutate: publishAllChapters, isPending: publishingAll } = useMutation({
    mutationFn: () => setAllChaptersPublished({ data: { novelId, publishedAt: new Date() } }),
    onSuccess: ({ count }) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success(`Published ${count} chapter${count === 1 ? "" : "s"}`);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to publish all chapters");
    },
  });

  const { mutateAsync: saveChapterEdit, isPending: savingEdit } = useMutation({
    mutationFn: (vars: UpdateChapterInput) => updateChapterRaw({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success("Chapter updated");
      setEditState(null);
      setEditErrors({});
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update chapter");
    },
  });

  const missingTitleCount = useMemo(
    () => chapters.filter((c) => c.status === "translated" && !c.translatedTitle).length,
    [chapters],
  );

  const unpublishedCount = useMemo(
    () => chapters.filter((c) => !c.publishedAt || new Date(c.publishedAt) > new Date()).length,
    [chapters],
  );

  const chapterGroups = useMemo(() => {
    const groups: (typeof chapters)[] = [];
    for (let i = 0; i < chapters.length; i += CHAPTER_GROUP_SIZE) {
      groups.push(chapters.slice(i, i + CHAPTER_GROUP_SIZE));
    }
    return groups;
  }, [chapters]);

  const [exporting, setExporting] = useState<"txt" | "epub" | null>(null);

  const handleExportTxt = async () => {
    setExporting("txt");
    try {
      const res = await exportNovelTxt({ data: { novelId } });
      downloadText(res.filename, res.content);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const handleExportEpub = async () => {
    setExporting("epub");
    try {
      const res = await exportNovelEpub({ data: { novelId } });
      downloadBase64(res.filename, res.dataBase64, "application/epub+zip");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const { mutate: backfillTitles, isPending: backfillingTitles } = useMutation({
    mutationFn: () => translateMissingTitles({ data: { novelId } }),
    onSuccess: ({ translated }) => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      toast.success(
        translated > 0 ? `Translated ${translated} chapter title(s)` : "No titles translated",
      );
    },
    onError: (error) => {
      toast.error(error.message || "Failed to translate titles");
    },
  });

  const handleStartEdit = async (chapter: ChapterRow) => {
    setEditState({
      chapterId: chapter.id,
      number: String(Number(chapter.number)),
      title: chapter.title,
      rawContent: "",
      contentLoading: true,
    });
    setEditErrors({});

    try {
      const full = await getChapter({ data: { chapterId: chapter.id } });
      setEditState((s) =>
        s?.chapterId === chapter.id
          ? { ...s, rawContent: full?.rawContent ?? "", contentLoading: false }
          : s,
      );
    } catch {
      setEditState((s) => (s?.chapterId === chapter.id ? { ...s, contentLoading: false } : s));
      toast.error("Failed to load chapter content");
    }
  };

  const handleSaveEdit = async () => {
    setEditErrors({});
    if (!editState) return;

    const payload = {
      chapterId: editState.chapterId,
      number: Number(editState.number),
      title: editState.title,
      rawContent: editState.rawContent,
    };

    const result = updateChapterSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
      });
      setEditErrors(fieldErrors);
      return;
    }

    await saveChapterEdit(payload);
  };

  const progressPercent = useMemo(() => {
    if (chapters.length === 0) return 0;
    const translatedCount = chapters.filter((c) => c.status === "translated").length;
    return Math.round((translatedCount / chapters.length) * 100);
  }, [chapters]);

  if (isNovelError || isChaptersError) {
    return (
      <QueryErrorState
        title="Failed to load novel"
        error={novelError || chaptersError}
        onRetry={() => {
          refetchNovel();
          refetchChapters();
        }}
        className="min-h-[40vh] my-12"
      />
    );
  }

  if (!novel) {
    return (
      <div className="text-center py-12">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <p className="text-muted-foreground mt-2">The novel you are looking for does not exist.</p>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }

  const editingChapter = editState ? chapters.find((c) => c.id === editState.chapterId) : null;

  const chapterTableProps = {
    novelId,
    isAdmin: !!user,
    activeJobs,
    readChapterIds: readerProgress.readChapterIds,
    residualHanziMap,
    costData,
    selectedIds,
    allSelected,
    isTranslating: isRowTranslating,
    onToggleSelect: toggleSelect,
    onToggleSelectAll: toggleSelectAll,
    publishingChapter,
    onPublishChapter: publishChapter,
    onCancelTranslate: cancelTranslate,
    onRetryTranslate: retryTranslate,
    onStartTranslate: startTranslate,
    onRequestRetranslate: setRetranslateChapterId,
    onViewLogs: setLogChapterId,
    editingChapterId: editState?.chapterId ?? null,
    onStartEdit: handleStartEdit,
    onCancelEdit: () => setEditState(null),
    onDeleteChapter: setDeleteChapterId,
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Novel Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" render={<Link to="/" />} aria-label="Go to Library">
            <ArrowLeft className="size-4" />
          </Button>
          {user && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/novels/$novelId/glossary" params={{ novelId }} />}
                aria-label="Glossary"
                title="Glossary"
              >
                <BookOpen className="size-4" />
                <span className="hidden sm:inline">Glossary</span>
                {glossaryStats && glossaryStats.total > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-mono">
                    {glossaryStats.total}
                  </Badge>
                )}
                {glossaryStats && glossaryStats.pending > 0 && (
                  <span className="size-2 rounded-full bg-amber-500 animate-pulse ml-0.5" />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" disabled={exporting !== null} />}
                  aria-label="Export novel"
                  title="Export novel"
                >
                  {exporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  <span className="hidden sm:inline">Export</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={handleExportTxt}>
                      <FileText className="size-4" />
                      Novel as .txt
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportEpub}>
                      <FileType className="size-4" />
                      Novel as .epub
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                render={<Link to="/novels/$novelId/edit" params={{ novelId }} />}
                aria-label="Edit novel"
                title="Edit novel"
              >
                <Edit className="size-4" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteNovelOpen(true)}
                aria-label="Delete novel"
                title="Delete novel"
              >
                <Trash2 className="size-4" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
          <div className="relative aspect-3/4 w-full max-w-50 overflow-hidden rounded-xl border border-border bg-foreground/3 flex items-center justify-center self-start">
            <NovelCover
              novelId={novel.id}
              coverVersion={novel.updatedAt}
              alt={novel.title}
              className="h-full w-full object-cover"
              fallbackSize={16}
            />
          </div>

          <div className="flex flex-col gap-4 flex-1">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-card-title sm:text-sub md:text-section font-semibold text-foreground tracking-tight">
                  {novel.title}
                </h1>
                <Badge
                  variant="outline"
                  className="uppercase font-semibold text-xs border-foreground/40"
                >
                  {novel.sourceLang} → {novel.targetLang}
                </Badge>
              </div>
              {novel.originalTitle && (
                <p className="text-body text-muted-foreground mt-1 font-medium">
                  {novel.originalTitle}
                </p>
              )}
              {novel.author && (
                <p className="text-sm text-muted-foreground mt-0.5">By {novel.author}</p>
              )}
            </div>

            {novel.description && (
              <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed whitespace-pre-wrap">
                {novel.description}
              </p>
            )}

            {chapters.length > 0 && (
              <div className="pt-2 flex flex-wrap items-center gap-2">
                {lastReadChapter ? (
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
                    render={
                      <Link
                        to="/novels/$novelId/chapters/$chapterId"
                        params={{ novelId, chapterId: lastReadChapter.id }}
                      />
                    }
                  >
                    <BookOpen className="size-4" />
                    <span>Continue Reading</span>
                    <span className="text-xs opacity-75 font-normal truncate max-w-50">
                      ({lastReadChapter.translatedTitle ?? lastReadChapter.title})
                    </span>
                  </Button>
                ) : firstChapter ? (
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
                    render={
                      <Link
                        to="/novels/$novelId/chapters/$chapterId"
                        params={{ novelId, chapterId: firstChapter.id }}
                      />
                    }
                  >
                    <BookOpen className="size-4" />
                    <span>Read First Chapter</span>
                  </Button>
                ) : null}

                {lastReadChapter && firstChapter && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    render={
                      <Link
                        to="/novels/$novelId/chapters/$chapterId"
                        params={{ novelId, chapterId: firstChapter.id }}
                      />
                    }
                  >
                    Read First Chapter
                  </Button>
                )}
              </div>
            )}

            <div className="max-w-md pt-2 flex flex-col gap-1.5">
              <div className="flex justify-between text-caption text-muted-foreground">
                <span>Overall Translation Progress</span>
                <span>
                  {progressPercent}% ({chapters.filter((c) => c.status === "translated").length}/
                  {chapters.length} chapters)
                </span>
              </div>
              <Progress value={progressPercent} className="h-2" />
              {costData &&
                (costData.totals.promptTokens > 0 || costData.totals.completionTokens > 0) && (
                  <div className="flex justify-between text-caption text-muted-foreground font-mono">
                    <span>Translation usage</span>
                    <span>
                      {formatTokens(costData.totals.promptTokens)} in /{" "}
                      {formatTokens(costData.totals.completionTokens)} out
                      {costData.totals.cost != null && ` · ${formatCost(costData.totals.cost)}`}
                    </span>
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>

      <hr className="border-border" />

      {/* Chapters Table */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sub font-semibold text-foreground tracking-tight">Chapters</h2>
          {user && (
            <div className="flex items-center flex-wrap gap-2">
              {selectedIds.size > 0 && (
                <>
                  <span className="text-caption text-muted-foreground shrink-0">
                    {selectedIds.size}/{selectableIds.length} selected
                  </span>
                  <Button size="sm" onClick={handleBatchTranslate} disabled={batchStarting}>
                    {batchStarting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    {batchStarting ? "Queueing..." : `Translate selected`}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                    <X className="size-4" />
                    Clear
                  </Button>
                </>
              )}
              {selectedIds.size === 0 && (
                <div className="flex items-center flex-wrap gap-1.5">
                  <Input
                    type="number"
                    min="1"
                    className="w-16 sm:w-20 h-8 text-xs"
                    placeholder="from"
                    value={batchRangeFrom}
                    onChange={(e) => setBatchRangeFrom(e.target.value)}
                  />
                  <span className="text-caption text-muted-foreground">–</span>
                  <Input
                    type="number"
                    min="1"
                    className="w-16 sm:w-20 h-8 text-xs"
                    placeholder="to"
                    value={batchRangeTo}
                    onChange={(e) => setBatchRangeTo(e.target.value)}
                  />
                  <Button variant="outline" size="sm" onClick={selectByRange}>
                    Select range
                  </Button>
                </div>
              )}
              {unpublishedCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => publishAllChapters()}
                  disabled={publishingAll}
                >
                  <Check className="size-4" />
                  {publishingAll ? "Publishing..." : `Publish all (${unpublishedCount})`}
                </Button>
              )}
              {missingTitleCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => backfillTitles()}
                  disabled={backfillingTitles}
                >
                  <Languages className="size-4" />
                  {backfillingTitles
                    ? "Translating titles..."
                    : `Translate titles (${missingTitleCount})`}
                </Button>
              )}
            </div>
          )}
        </div>

        {chapters.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
            <FileText className="size-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {user
                ? "No chapters in this novel yet. Paste one below to start."
                : "No chapters published yet."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {chapterGroups.length <= 1 ? (
              <ChapterTable chapters={chapters} {...chapterTableProps} />
            ) : (
              <Accordion multiple defaultValue={[0]}>
                {chapterGroups.map((group, gi) => (
                  <AccordionItem key={gi} value={gi}>
                    <AccordionTrigger>
                      <span>
                        Chapters {Number(group[0].number)}–{Number(group[group.length - 1].number)}
                        <span className="ml-2 font-normal text-muted-foreground">
                          ({group.length})
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionPanel>
                      <ChapterTable chapters={group} {...chapterTableProps} />
                    </AccordionPanel>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        )}

        {/* Inline chapter editor (below table) */}
        {editState && editingChapter && (
          <Card className="border-foreground/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-card-title font-semibold text-foreground">
                  Editing: {editingChapter.title}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => {
                    setEditState(null);
                    setEditErrors({});
                  }}
                  aria-label="Close editor"
                >
                  <X className="size-4" />
                </Button>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1.5 sm:col-span-1">
                    <Label htmlFor="edit-chapNumber">Number *</Label>
                    <Input
                      id="edit-chapNumber"
                      type="number"
                      step="0.01"
                      min="0"
                      value={editState.number}
                      onChange={(e) => {
                        setEditErrors((err) => ({ ...err, number: "" }));
                        setEditState((s) => s && { ...s, number: e.target.value });
                      }}
                    />
                    {editErrors.number && (
                      <span className="text-caption text-destructive">{editErrors.number}</span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 sm:col-span-3">
                    <Label htmlFor="edit-chapTitle">Title *</Label>
                    <Input
                      id="edit-chapTitle"
                      value={editState.title}
                      onChange={(e) => {
                        setEditErrors((err) => ({ ...err, title: "" }));
                        setEditState((s) => s && { ...s, title: e.target.value });
                      }}
                    />
                    {editErrors.title && (
                      <span className="text-caption text-destructive">{editErrors.title}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-baseline">
                    <Label htmlFor="edit-chapContent">Raw Content</Label>
                    {!editState.contentLoading && (
                      <span className="text-caption text-muted-foreground">
                        {editState.rawContent.length.toLocaleString()} characters
                      </span>
                    )}
                  </div>
                  {editState.contentLoading ? (
                    <div className="h-36 rounded-md border border-border bg-muted animate-pulse" />
                  ) : (
                    <Textarea
                      id="edit-chapContent"
                      value={editState.rawContent}
                      onChange={(e) => {
                        setEditErrors((err) => ({ ...err, rawContent: "" }));
                        setEditState((s) => s && { ...s, rawContent: e.target.value });
                      }}
                      rows={10}
                    />
                  )}
                  {editErrors.rawContent && (
                    <span className="text-caption text-destructive">{editErrors.rawContent}</span>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditState(null);
                      setEditErrors({});
                    }}
                    disabled={savingEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={savingEdit || editState.contentLoading}
                  >
                    <Check className="size-4" />
                    {savingEdit ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {user && (
        <AddChapterSection
          novelId={novelId}
          chapters={chapters}
          invalidateChapters={invalidateChapters}
        />
      )}

      {/* Confirmation Dialogs */}
      <DeleteConfirmDialog
        title="Delete Novel Project"
        description="Are you absolutely sure you want to delete this novel? This action is permanent and will delete all chapters, glossaries, and translation jobs associated with it."
        open={deleteNovelOpen}
        onOpenChange={setDeleteNovelOpen}
        onConfirm={removeNovel}
        pending={deletingNovel}
      />

      <DeleteConfirmDialog
        title="Delete Chapter"
        description="Are you sure you want to delete this chapter? This action is permanent and cannot be undone."
        open={deleteChapterId !== null}
        onOpenChange={(open) => !open && setDeleteChapterId(null)}
        onConfirm={() => deleteChapterId && removeChapter({ chapterId: deleteChapterId })}
        pending={deletingChapter}
      />

      <JobLogsDialog
        chapterId={logChapterId}
        open={logChapterId !== null}
        onOpenChange={(open) => !open && setLogChapterId(null)}
      />

      <ConfirmDialog
        title="Overwrite Edited Translation?"
        description="This chapter was manually edited. Re-translating will overwrite your manual changes with a new machine translation."
        confirmText="Overwrite & Translate"
        open={retranslateChapterId !== null}
        onOpenChange={(open) => !open && setRetranslateChapterId(null)}
        onConfirm={() => {
          if (retranslateChapterId) {
            startTranslate(retranslateChapterId);
            setRetranslateChapterId(null);
          }
        }}
      />
    </div>
  );
}
