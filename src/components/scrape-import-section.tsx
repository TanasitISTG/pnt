import { useState } from "react";
import { toast } from "sonner";

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
import { scrapeChapter, importChapter } from "@/lib/scrape.functions";
import { SCRAPE_PROVIDERS, SUPPORTED_SITES_LABEL } from "@/lib/scrape";
import type { ScrapeProvider } from "@/lib/scrape.types";
import { useImportJob } from "@/components/use-import-job";

interface ScrapeImportSectionProps {
  novelId: string;
  invalidateChapters: () => void;
  onChapterFetched: (chapter: { number: string; title: string; content: string }) => void;
}

export function ScrapeImportSection({
  novelId,
  invalidateChapters,
  onChapterFetched,
}: ScrapeImportSectionProps) {
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeProvider, setScrapeProvider] = useState<ScrapeProvider>("auto");
  const [scrapeBusy, setScrapeBusy] = useState<"fetch" | "add" | null>(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const { importJob, importActive, startImport, cancelImport } = useImportJob(
    novelId,
    invalidateChapters,
  );

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
    await startImport(scrapeUrl, from, to, scrapeProvider);
  };

  const handleScrapeFetch = async () => {
    setScrapeBusy("fetch");
    try {
      const r = await scrapeChapter({ data: { url: scrapeUrl, provider: scrapeProvider } });
      onChapterFetched({ number: String(r.number), title: r.title, content: r.content });
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

  return (
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
                {SCRAPE_PROVIDERS.find((p) => p.id === scrapeProvider)?.label ?? "Automatic"}
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
            <Button type="button" variant="ghost" className="shrink-0" onClick={cancelImport}>
              Cancel
            </Button>
          )}
        </div>
      </div>
      {importJob && (
        <p className="text-caption text-muted-foreground wrap-break-word">
          {importJob.nextNumber - importJob.fromNumber}/
          {importJob.toNumber - importJob.fromNumber + 1} — added {importJob.added} · skipped{" "}
          {importJob.skipped} · failed {importJob.failed}
          {importActive ? " (runs server-side — safe to close this tab)" : ""}
        </p>
      )}
      <p className="text-caption text-muted-foreground">Supported: {SUPPORTED_SITES_LABEL}</p>
    </div>
  );
}
