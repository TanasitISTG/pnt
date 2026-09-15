import { useState } from "react";

import { ChapterImportStatus } from "@/components/chapters/chapter-import-status";
import type { ImportJobController } from "@/components/chapters/use-import-job";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { importChapter, scrapeChapter } from "@/lib/scrape/functions";
import { SCRAPE_PROVIDERS, SUPPORTED_SITES_LABEL } from "@/lib/scrape";
import type { ScrapeProvider } from "@/lib/scrape/types";
import { toast } from "sonner";

interface ScrapeImportSectionProps {
  novelId: string;
  invalidateChapters: () => void;
  importController: ImportJobController;
  bulkStartDisabled: boolean;
  onChapterFetched: (chapter: {
    number: string;
    title: string;
    content: string;
    sourceUrl: string;
  }) => void;
  otherImportActive: boolean;
}

const INVALID_RANGE_MESSAGE =
  "Enter a valid range: first chapter must be at least 1, last chapter cannot be earlier, and the range can contain at most 500 chapters.";

export function ScrapeImportSection({
  novelId,
  invalidateChapters,
  importController,
  bulkStartDisabled,
  onChapterFetched,
  otherImportActive,
}: ScrapeImportSectionProps) {
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeProvider, setScrapeProvider] = useState<ScrapeProvider>("auto");
  const [scrapeBusy, setScrapeBusy] = useState<"fetch" | "add" | null>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const selectedProvider =
    SCRAPE_PROVIDERS.find((provider) => provider.id === scrapeProvider) ?? SCRAPE_PROVIDERS[0];

  const handleRangeImport = async () => {
    if (
      bulkStartDisabled ||
      importController.importActive ||
      importController.startPending ||
      otherImportActive
    ) {
      return;
    }

    setActionError(null);
    const from = Number(rangeFrom);
    const to = Number(rangeTo);
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 1 ||
      from > to ||
      to - from + 1 > 500
    ) {
      setRangeError(INVALID_RANGE_MESSAGE);
      return;
    }
    setRangeError(null);
    await importController.startImport(scrapeUrl, from, to, scrapeProvider);
  };

  const handleScrapeFetch = async () => {
    setActionError(null);
    setScrapeBusy("fetch");
    const sourceUrl = scrapeUrl;
    try {
      const result = await scrapeChapter({ data: { url: sourceUrl, provider: scrapeProvider } });
      onChapterFetched({
        number: String(result.number),
        title: result.title,
        content: result.content,
        sourceUrl,
      });
      if (result.nextUrl) setScrapeUrl(result.nextUrl);
      toast.success(`Fetched chapter ${result.number}: ${result.title}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Fetch failed";
      setActionError(message);
    } finally {
      setScrapeBusy(null);
    }
  };

  const handleScrapeAdd = async () => {
    setActionError(null);
    setScrapeBusy("add");
    try {
      const result = await importChapter({
        data: { novelId, url: scrapeUrl, provider: scrapeProvider },
      });
      if (result.created) {
        invalidateChapters();
        toast.success(`Added chapter ${result.number}: ${result.title}`);
      } else {
        toast.info(`Chapter ${result.number} already exists — skipped`);
      }
      if (result.nextUrl) setScrapeUrl(result.nextUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Import failed";
      setActionError(message);
    } finally {
      setScrapeBusy(null);
    }
  };

  const setUrl = (value: string) => {
    setScrapeUrl(value);
    setActionError(null);
  };

  const setProvider = (value: string | null) => {
    if (!value) return;
    setScrapeProvider(value as ScrapeProvider);
    setActionError(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-tight text-foreground">Import from URL</h3>
        <p className="text-sm text-muted-foreground">
          Use a supported chapter URL to review one chapter or queue a range.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="scrapeUrl">Chapter source URL</Label>
          <Input
            id="scrapeUrl"
            name="sourceUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://www.quanben.io/n/.../30.html"
            value={scrapeUrl}
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="scrapeProviderSelect">Fetch method</Label>
            <Select value={scrapeProvider} onValueChange={setProvider}>
              <SelectTrigger id="scrapeProviderSelect" className="w-full">
                <SelectValue>{selectedProvider?.label ?? "Automatic"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SCRAPE_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{selectedProvider?.description}</p>
            <p className="text-sm text-muted-foreground">
              Supported sites: {SUPPORTED_SITES_LABEL}
            </p>
          </div>
        </div>
      </div>

      <section
        className="flex flex-col gap-4 border-t border-border pt-5"
        aria-labelledby="single-chapter-heading"
      >
        <div className="flex flex-col gap-1">
          <h4 id="single-chapter-heading" className="text-base font-semibold text-foreground">
            Single chapter
          </h4>
          <p className="text-sm text-muted-foreground">
            Preview the source before adding it, or add it directly.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            onClick={handleScrapeFetch}
            disabled={!scrapeUrl || scrapeBusy !== null}
          >
            {scrapeBusy === "fetch" ? "Fetching chapter…" : "Preview chapter"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleScrapeAdd}
            disabled={!scrapeUrl || scrapeBusy !== null}
          >
            {scrapeBusy === "add" ? "Adding chapter…" : "Add without preview"}
          </Button>
        </div>
        {actionError ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {actionError}
          </div>
        ) : null}
      </section>

      <section
        className="flex flex-col gap-4 border-t border-border pt-5"
        aria-labelledby="chapter-range-heading"
      >
        <div className="flex flex-col gap-1">
          <h4 id="chapter-range-heading" className="text-base font-semibold text-foreground">
            Chapter range
          </h4>
          <p className="text-sm text-muted-foreground">
            Runs on the server; you can leave this page after it starts.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="importRangeFrom">First chapter</Label>
            <Input
              type="number"
              min="1"
              id="importRangeFrom"
              name="rangeFrom"
              autoComplete="off"
              placeholder="e.g. 1"
              value={rangeFrom}
              onChange={(event) => {
                setRangeFrom(event.target.value);
                setRangeError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="importRangeTo">Last chapter</Label>
            <Input
              type="number"
              min="1"
              id="importRangeTo"
              name="rangeTo"
              autoComplete="off"
              placeholder="e.g. 5"
              value={rangeTo}
              onChange={(event) => {
                setRangeTo(event.target.value);
                setRangeError(null);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleRangeImport}
            disabled={
              !scrapeUrl ||
              bulkStartDisabled ||
              importController.importActive ||
              importController.startPending ||
              otherImportActive
            }
          >
            {importController.importActive ? "Importing…" : "Start range import"}
          </Button>
        </div>

        {otherImportActive ? (
          <p className="text-sm text-muted-foreground" role="status">
            Finish or cancel the EPUB import before starting another bulk import.
          </p>
        ) : null}
        {rangeError ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {rangeError}
          </div>
        ) : null}

        <ChapterImportStatus
          label="URL range import"
          job={importController.importJob}
          active={importController.importActive}
          statusError={importController.importStatusError}
          onRetryStatus={importController.retryImportStatus}
        />

        {importController.importActive ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={importController.cancelImport}
          >
            Cancel import
          </Button>
        ) : null}

        {importController.canRetryImport &&
        importController.importJob &&
        (importController.importJob.status === "error" ||
          importController.importJob.status === "cancelled") ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-muted-foreground">
              {importController.importJob.status === "error"
                ? "This import stopped. Already imported chapters remain saved."
                : "This import was cancelled. You can resume the same range."}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void importController.retryImport()}
              disabled={bulkStartDisabled || otherImportActive || importController.startPending}
            >
              Retry range import
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
