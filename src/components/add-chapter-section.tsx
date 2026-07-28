import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createChapter } from "@/lib/novel.functions";
import { createChapterSchema, type CreateChapterInput } from "@/lib/novel.schemas";
import {
  scrapeChapter,
  importChapter,
  startImportJob,
  cancelImportJob,
  getImportJobStatus,
  getActiveImportJob,
} from "@/lib/scrape.functions";
import { SCRAPE_PROVIDERS, SUPPORTED_SITES_LABEL } from "@/lib/scrape";
import type { ScrapeProvider } from "@/lib/scrape.types";

interface AddChapterSectionProps {
  novelId: string;
  chapters: Array<{ number: string }>;
  invalidateChapters: () => void;
}

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

export function AddChapterSection({
  novelId,
  chapters,
  invalidateChapters,
}: AddChapterSectionProps) {
  const autoNextNumber = useMemo(() => {
    if (chapters.length === 0) return 1;
    const maxNum = Math.max(...chapters.map((c) => Number(c.number || 0)), 0);
    return Math.floor(maxNum) + 1;
  }, [chapters]);

  // Manual chapter form state
  const [chapNumber, setChapNumber] = useState<string>(() => autoNextNumber.toString());
  const [chapTitle, setChapTitle] = useState("");
  const [chapContent, setChapContent] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Sync chapNumber when autoNextNumber prop changes
  useEffect(() => {
    setChapNumber(autoNextNumber.toString());
  }, [autoNextNumber]);

  // Scrape/import state
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeProvider, setScrapeProvider] = useState<ScrapeProvider>("auto");
  const [scrapeBusy, setScrapeBusy] = useState<"fetch" | "add" | null>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const [importJob, setImportJob] = useState<ImportJobState | null>(null);
  const importActive = importJob?.status === "pending" || importJob?.status === "running";

  // Re-attach to a running import after refresh
  useEffect(() => {
    let cancelled = false;
    getActiveImportJob({ data: { novelId } })
      .then((job) => {
        if (!cancelled && job) setImportJob(job);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [novelId]);

  // Poll active import job (read-only, idempotent)
  useEffect(() => {
    if (!importJob || !importActive) return;
    const interval = setInterval(async () => {
      if (document.hidden) return;
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
  }, [importJob?.id, importActive, invalidateChapters]);

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
        data: { novelId, baseUrl: scrapeUrl, from, to, provider: scrapeProvider },
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start import");
    }
  };

  const handleImportCancel = async () => {
    if (!importJob) return;
    try {
      await cancelImportJob({ data: { jobId: importJob.id } });
      setImportJob((j) => (j ? { ...j, status: "cancelled" } : j));
      invalidateChapters();
      toast.info("Import cancelled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel import");
    }
  };

  const handleScrapeFetch = async () => {
    setScrapeBusy("fetch");
    try {
      const r = await scrapeChapter({ data: { url: scrapeUrl, provider: scrapeProvider } });
      setChapNumber(String(r.number));
      setChapTitle(r.title);
      setChapContent(r.content);
      setFormErrors({});
      if (r.nextUrl) setScrapeUrl(r.nextUrl);
      toast.success(`Fetched chapter ${r.number}: ${r.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setScrapeBusy(null);
    }
  };

  const handleScrapeAdd = async () => {
    setScrapeBusy("add");
    try {
      const r = await importChapter({
        data: { novelId, url: scrapeUrl, provider: scrapeProvider },
      });
      if (r.created) {
        invalidateChapters();
        toast.success(`Added chapter ${r.number}: ${r.title}`);
      } else {
        toast.info(`Chapter ${r.number} already exists — skipped`);
      }
      if (r.nextUrl) setScrapeUrl(r.nextUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setScrapeBusy(null);
    }
  };

  const { mutateAsync: addChapter, isPending: addingChapter } = useMutation({
    mutationFn: (vars: CreateChapterInput) => createChapter({ data: vars }),
    onSuccess: () => {
      invalidateChapters();
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

    // onError toasts the failure; swallow the rejection so it isn't unhandled.
    await addChapter(payload).catch(() => {});
  };

  return (
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
              <div className="flex flex-col sm:flex-row sm:items-center flex-wrap gap-2.5 pt-1">
                <div className="flex items-center gap-2 shrink-0">
                  <Label
                    htmlFor="scrapeProviderSelect"
                    className="text-caption text-muted-foreground shrink-0"
                  >
                    Provider
                  </Label>
                  <Select
                    value={scrapeProvider}
                    onValueChange={(val) => setScrapeProvider(val as ScrapeProvider)}
                  >
                    <SelectTrigger id="scrapeProviderSelect" className="h-9 w-36">
                      <SelectValue>
                        {SCRAPE_PROVIDERS.find((p) => p.id === scrapeProvider)?.label ??
                          "Automatic"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {SCRAPE_PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
              <p className="text-caption text-muted-foreground">
                Supported: {SUPPORTED_SITES_LABEL}
              </p>
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
  );
}
