import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  ArrowLeft,
  Edit,
  Trash2,
  FileText,
  X,
  Check,
  Play,
  RotateCw,
  Square,
  Terminal,
  BookOpen,
  Download,
  FileType,
  Languages,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { NovelCover } from "@/components/novel-cover";
import { useTranslationJob } from "@/lib/translation/use-translation-job";
import { JobLogsDialog } from "@/components/job-logs-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { getReaderProgress, type ReaderProgress } from "@/lib/reader-progress";

import {
  getNovel,
  getChapter,
  deleteNovel,
  listChapters,
  createChapter,
  deleteChapter,
  updateChapterRaw,
  translateMissingTitles,
  setChapterPublished,
  setAllChaptersPublished,
} from "@/lib/novel.functions";
import {
  scrapeChapter,
  importChapter,
  startImportJob,
  cancelImportJob,
  getImportJobStatus,
  getActiveImportJob,
} from "@/lib/scrape.functions";
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
import { PublishMenu } from "@/components/publish-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "@/components/ui/accordion";
import { ChapterStatusBadge } from "@/components/chapter-status-badge";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { createChapterSchema, updateChapterSchema } from "@/lib/novel.schemas";
import { cn } from "#/lib/utils";

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

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const formatCost = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

const CHAPTER_GROUP_SIZE = 50;

export const Route = createFileRoute("/_public/novels/$novelId/")({
  loader: async ({ params, context }) => {
    const tasks: Promise<unknown>[] = [
      context.queryClient.ensureQueryData(novelQueryOptions(params.novelId)),
      context.queryClient.ensureQueryData(chaptersQueryOptions(params.novelId)),
    ];
    // Admin-only data — these endpoints require a session, skip for guests.
    if (context.user) {
      tasks.push(
        context.queryClient.ensureQueryData(glossaryStatsQueryOptions(params.novelId)),
        context.queryClient.ensureQueryData(costsQueryOptions(params.novelId)),
      );
    }
    await Promise.all(tasks);
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

  const selectableIds = chapters.filter((c) => !isRowTranslating(c.id, c.status)).map((c) => c.id);
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

  // Add chapter form state
  const autoNextNumber = useMemo(() => {
    if (chapters.length === 0) return 1;
    const maxNum = Math.max(...chapters.map((c) => Number(c.number || 0)), 0);
    return Math.floor(maxNum) + 1;
  }, [chapters]);

  const [chapNumber, setChapNumber] = useState<string>(autoNextNumber.toString());
  const [chapTitle, setChapTitle] = useState("");
  const [chapContent, setChapContent] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Scrape/import state
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeBusy, setScrapeBusy] = useState<"fetch" | "add" | null>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  interface ImportJobState {
    id: string;
    status: string;
    fromNumber: number;
    toNumber: number;
    nextNumber: number;
    added: number;
    skipped: number;
    failed: number;
    error: string | null;
  }
  const [importJob, setImportJob] = useState<ImportJobState | null>(null);
  const importActive = importJob?.status === "pending" || importJob?.status === "running";

  const invalidateChapters = () => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
  };

  // Re-attach to a running import after refresh — the job lives server-side.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getActiveImportJob({ data: { novelId } })
      .then((job) => {
        if (!cancelled && job) setImportJob(job);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [novelId, user]);

  // Poll active import job (read-only, idempotent)
  useEffect(() => {
    if (!importJob || !importActive) return;
    const interval = setInterval(async () => {
      try {
        const res = await getImportJobStatus({ data: { jobId: importJob.id } });
        if (!res) {
          setImportJob(null);
          return;
        }
        setImportJob(res);
        if (res.status === "done") {
          invalidateChapters();
          toast.success(
            `Import done: added ${res.added}, skipped ${res.skipped}, failed ${res.failed}`,
          );
        } else if (res.status === "error") {
          invalidateChapters();
          toast.error(`Import failed: ${res.error || "Unknown error"}`);
        } else if (res.status === "cancelled") {
          invalidateChapters();
          toast.info("Import cancelled");
        }
      } catch {
        // Transient read failure — next poll retries.
      }
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importJob?.id, importActive]);

  const handleRangeImport = async () => {
    const from = Number(rangeFrom);
    const to = Number(rangeTo);
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      from > to ||
      to - from > 500
    ) {
      toast.error("Enter a valid range (from ≥ 1, from ≤ to, max 500 chapters)");
      return;
    }
    try {
      const { jobId } = await startImportJob({
        data: { novelId, baseUrl: scrapeUrl, from, to },
      });
      setImportJob({
        id: jobId,
        status: "pending",
        fromNumber: from,
        toNumber: to,
        nextNumber: from,
        added: 0,
        skipped: 0,
        failed: 0,
        error: null,
      });
      toast.info(`Import of chapters ${from}–${to} queued`);
    } catch (e: any) {
      toast.error(e.message || "Failed to start import");
    }
  };

  const handleImportCancel = async () => {
    if (!importJob) return;
    try {
      await cancelImportJob({ data: { jobId: importJob.id } });
      setImportJob((j) => (j ? { ...j, status: "cancelled" } : j));
      invalidateChapters();
      toast.info("Import cancelled");
    } catch (e: any) {
      toast.error(e.message || "Failed to cancel import");
    }
  };

  const handleScrapeFetch = async () => {
    setScrapeBusy("fetch");
    try {
      const r = await scrapeChapter({ data: { url: scrapeUrl } });
      setChapNumber(String(r.number));
      setChapTitle(r.title);
      setChapContent(r.content);
      setFormErrors({});
      if (r.nextUrl) setScrapeUrl(r.nextUrl);
      toast.success(`Fetched chapter ${r.number}: ${r.title}`);
    } catch (e: any) {
      toast.error(e.message || "Fetch failed");
    } finally {
      setScrapeBusy(null);
    }
  };

  const handleScrapeAdd = async () => {
    setScrapeBusy("add");
    try {
      const r = await importChapter({ data: { novelId, url: scrapeUrl } });
      if (r.created) {
        invalidateChapters();
        toast.success(`Added chapter ${r.number}: ${r.title}`);
      } else {
        toast.info(`Chapter ${r.number} already exists — skipped`);
      }
      if (r.nextUrl) setScrapeUrl(r.nextUrl);
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setScrapeBusy(null);
    }
  };

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

  const { mutateAsync: addChapter, isPending: addingChapter } = useMutation({
    mutationFn: (vars: any) => createChapter({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
      queryClient.invalidateQueries({ queryKey: ["novels"] });
      toast.success("Chapter added successfully");
      setChapTitle("");
      setChapContent("");
      setFormErrors({});
      const nextNum = Number(chapNumber) + 1;
      setChapNumber(isNaN(nextNum) ? "" : nextNum.toString());
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add chapter");
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
    mutationFn: (vars: any) => updateChapterRaw({ data: vars }),
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
    } catch (err: any) {
      toast.error(err.message || "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const handleExportEpub = async () => {
    setExporting("epub");
    try {
      const res = await exportNovelEpub({ data: { novelId } });
      downloadBase64(res.filename, res.dataBase64, "application/epub+zip");
    } catch (err: any) {
      toast.error(err.message || "Export failed");
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

  const handleAddChapter = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setFormErrors({});

    const num = Number(chapNumber);
    const payload = { novelId, number: num, title: chapTitle, rawContent: chapContent };

    const result = createChapterSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0] !== undefined) {
          fieldErrors[String(issue.path[0])] = issue.message;
        }
      });
      setFormErrors(fieldErrors);
      return;
    }

    await addChapter(payload);
  };

  const handleStartEdit = async (chapter: (typeof chapters)[0]) => {
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

  const renderChapterRow = (chapter: (typeof chapters)[0]) => {
    const activeJob = activeJobs.get(chapter.id);
    const isTranslating = isRowTranslating(chapter.id, chapter.status);
    const isRead = readerProgress.readChapterIds.includes(chapter.id);

    return (
      <TableRow
        key={chapter.id}
        data-editing={editState?.chapterId === chapter.id ? "true" : undefined}
        className="data-[editing=true]:bg-muted/50"
      >
        {user && (
          <TableCell className="w-10">
            <input
              type="checkbox"
              checked={selectedIds.has(chapter.id)}
              disabled={isTranslating}
              onChange={(e) => toggleSelect(chapter.id, e.target.checked)}
              aria-label={`Select chapter ${Number(chapter.number)}`}
              className="size-4 accent-primary align-middle"
            />
          </TableCell>
        )}
        <TableCell className="font-medium">{Number(chapter.number)}</TableCell>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            <Link
              to="/novels/$novelId/chapters/$chapterId"
              params={{ novelId, chapterId: chapter.id }}
              className={cn(
                "text-foreground hover:underline underline-offset-4",
                isRead && "text-muted-foreground/80 font-normal",
              )}
            >
              {chapter.translatedTitle ?? chapter.title}
            </Link>
            {isRead && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0"
                title="Read"
                aria-label="Read"
              >
                <Check className="size-3.5" aria-hidden="true" />
                <span className="text-[11px] font-normal">Read</span>
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {chapter.rawCharCount.toLocaleString()}
          {costData?.costs[chapter.id] && (
            <div className="text-caption font-mono text-muted-foreground">
              {formatTokens(
                costData.costs[chapter.id].promptTokens +
                  costData.costs[chapter.id].completionTokens,
              )}{" "}
              tok
              {costData.costs[chapter.id].cost != null &&
                ` · ${formatCost(costData.costs[chapter.id].cost!)}`}
            </div>
          )}
        </TableCell>
        <TableCell>
          {activeJob && (activeJob.status === "running" || activeJob.status === "pending") ? (
            <div className="flex flex-col gap-1 min-w-28">
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
            <ChapterStatusBadge status={chapter.status} />
          )}
        </TableCell>
        {user && (
          <TableCell className="text-right">
            <div className="flex justify-end items-center gap-1">
              <PublishMenu
                publishedAt={chapter.publishedAt}
                pending={publishingChapter}
                onChange={(publishedAt) => publishChapter({ chapterId: chapter.id, publishedAt })}
              />
              {isTranslating && activeJob ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-amber-500 hover:text-amber-600"
                  onClick={() => cancelTranslate(activeJob.jobId, chapter.id)}
                  aria-label="Cancel translation"
                  title="Cancel translation"
                >
                  <Square className="size-4" />
                </Button>
              ) : chapter.status === "error" || activeJob?.status === "error" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={() =>
                    activeJob
                      ? retryTranslate(activeJob.jobId, chapter.id)
                      : startTranslate(chapter.id)
                  }
                  aria-label="Retry translation"
                  title="Retry translation"
                >
                  <RotateCw className="size-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-primary hover:text-primary"
                  onClick={() => {
                    if (chapter.editedAt) {
                      setRetranslateChapterId(chapter.id);
                    } else {
                      startTranslate(chapter.id);
                    }
                  }}
                  aria-label={
                    chapter.status === "translated" ? "Re-translate chapter" : "Translate chapter"
                  }
                  title={
                    chapter.status === "translated" ? "Re-translate chapter" : "Translate chapter"
                  }
                >
                  <Play className="size-4" />
                </Button>
              )}
              {(activeJob || chapter.status !== "raw") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setLogChapterId(chapter.id)}
                  aria-label="View translation logs"
                  title="View translation logs"
                >
                  <Terminal className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() =>
                  editState?.chapterId === chapter.id
                    ? setEditState(null)
                    : handleStartEdit(chapter)
                }
                aria-label={editState?.chapterId === chapter.id ? "Cancel edit" : "Edit chapter"}
              >
                {editState?.chapterId === chapter.id ? (
                  <X className="size-4 text-muted-foreground" />
                ) : (
                  <Edit className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setDeleteChapterId(chapter.id)}
                aria-label="Delete chapter"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>
    );
  };

  const renderChapterTable = (groupChapters: typeof chapters) => (
    <Table>
      <TableHeader>
        <TableRow>
          {user && (
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleSelectAll(e.target.checked)}
                aria-label="Select all chapters"
                className="size-4 accent-primary align-middle"
              />
            </TableHead>
          )}
          <TableHead className="w-16">#</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-32">Chars</TableHead>
          <TableHead className="w-32">Status</TableHead>
          {user && <TableHead className="w-24 text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>{groupChapters.map(renderChapterRow)}</TableBody>
    </Table>
  );

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
              cover={novel.cover}
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sub font-semibold text-foreground tracking-tight">Chapters</h2>
          {user && (
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <>
                  <span className="text-caption text-muted-foreground">
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
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="1"
                    className="w-20 h-8 text-xs"
                    placeholder="from"
                    value={batchRangeFrom}
                    onChange={(e) => setBatchRangeFrom(e.target.value)}
                  />
                  <span className="text-caption text-muted-foreground">–</span>
                  <Input
                    type="number"
                    min="1"
                    className="w-20 h-8 text-xs"
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
              renderChapterTable(chapters)
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
                    <AccordionPanel>{renderChapterTable(group)}</AccordionPanel>
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
        <>
          <hr className="border-border" />

          {/* Add Chapter Form */}
          <div className="flex flex-col gap-4">
            <h2 className="text-sub font-semibold text-foreground tracking-tight">Add Chapter</h2>
            <Card className="max-w-3xl">
              <CardContent className="p-6">
                <div className="flex flex-col gap-3 rounded-md border border-border bg-muted p-4 mb-6">
                  <Label htmlFor="scrapeUrl">Import from source URL</Label>
                  <div className="flex flex-col sm:flex-row gap-2 w-full">
                    <Input
                      id="scrapeUrl"
                      placeholder="https://www.quanben.io/n/.../30.html"
                      value={scrapeUrl}
                      onChange={(e) => setScrapeUrl(e.target.value)}
                      className="w-full min-w-0 flex-1"
                    />
                    <div className="grid grid-cols-2 sm:flex sm:shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={handleScrapeFetch}
                        disabled={!scrapeUrl || scrapeBusy !== null}
                      >
                        {scrapeBusy === "fetch" ? "Fetching..." : "Fetch"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={handleScrapeAdd}
                        disabled={!scrapeUrl || scrapeBusy !== null}
                      >
                        {scrapeBusy === "add" ? "Adding..." : "Fetch & Add"}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-1">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <span className="text-caption text-muted-foreground shrink-0">Range</span>
                      <Input
                        type="number"
                        min="1"
                        id="importRangeFrom"
                        aria-label="Start chapter number"
                        className="w-full sm:w-24 min-w-0"
                        placeholder="from"
                        value={rangeFrom}
                        onChange={(e) => setRangeFrom(e.target.value)}
                      />
                      <span className="text-caption text-muted-foreground shrink-0">to</span>
                      <Input
                        type="number"
                        min="1"
                        id="importRangeTo"
                        aria-label="End chapter number"
                        className="w-full sm:w-24 min-w-0"
                        placeholder="to"
                        value={rangeTo}
                        onChange={(e) => setRangeTo(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={handleRangeImport}
                        disabled={!scrapeUrl || importActive}
                      >
                        {importActive ? "Importing..." : "Import Range"}
                      </Button>
                      {importActive && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="shrink-0"
                          onClick={handleImportCancel}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  {importJob && (
                    <p className="text-caption text-muted-foreground wrap-break-word">
                      {importJob.nextNumber - importJob.fromNumber}/
                      {importJob.toNumber - importJob.fromNumber + 1} — added {importJob.added} ·
                      skipped {importJob.skipped} · failed {importJob.failed}
                      {importActive ? " (runs server-side — safe to close this tab)" : ""}
                    </p>
                  )}
                  <p className="text-caption text-muted-foreground">Supported: quanben.io</p>
                </div>

                <form onSubmit={handleAddChapter} className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="flex flex-col gap-1.5 sm:col-span-1">
                      <Label htmlFor="chapNumber">Number *</Label>
                      <Input
                        id="chapNumber"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 1"
                        value={chapNumber}
                        onChange={(e) => {
                          setFormErrors((err) => ({ ...err, number: "" }));
                          setChapNumber(e.target.value);
                        }}
                        required
                      />
                      {formErrors.number && (
                        <span className="text-caption text-destructive">{formErrors.number}</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5 sm:col-span-3">
                      <Label htmlFor="chapTitle">Title *</Label>
                      <Input
                        id="chapTitle"
                        placeholder="e.g. The Awakening"
                        value={chapTitle}
                        onChange={(e) => {
                          setFormErrors((err) => ({ ...err, title: "" }));
                          setChapTitle(e.target.value);
                        }}
                        required
                      />
                      {formErrors.title && (
                        <span className="text-caption text-destructive">{formErrors.title}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-baseline">
                      <Label htmlFor="chapContent">Raw Content *</Label>
                      <span className="text-caption text-muted-foreground">
                        {chapContent.length.toLocaleString()} characters
                      </span>
                    </div>
                    <Textarea
                      id="chapContent"
                      placeholder="Paste raw chapter text here..."
                      value={chapContent}
                      onChange={(e) => {
                        setFormErrors((err) => ({ ...err, rawContent: "" }));
                        setChapContent(e.target.value);
                      }}
                      rows={8}
                      required
                    />
                    {formErrors.rawContent && (
                      <span className="text-caption text-destructive">{formErrors.rawContent}</span>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <Button type="submit" disabled={addingChapter}>
                      {addingChapter ? "Adding..." : "Add Chapter"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </>
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
