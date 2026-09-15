import { useCallback, useState } from "react";
import { BookOpen, ClipboardPaste, Link2 } from "lucide-react";

import { EpubImportSection } from "@/components/chapters/epub-import-section";
import {
  ManualChapterEditor,
  useManualChapterEditor,
  type FetchedChapterDraft,
} from "@/components/chapters/manual-chapter-editor";
import { ScrapeImportSection } from "@/components/chapters/scrape-import-section";
import { useImportJob } from "@/components/chapters/use-import-job";
import type { ImportJobController } from "@/components/chapters/use-import-job";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AddChapterMode = "manual" | "url" | "epub";

interface AddChapterSectionProps {
  novelId: string;
  chapters: Array<{ number: string }>;
  invalidateChapters: () => void;
}

const modeDetails: Record<
  AddChapterMode,
  { label: string; description: string; icon: typeof ClipboardPaste }
> = {
  manual: {
    label: "Paste text",
    description: "Create one chapter from source text.",
    icon: ClipboardPaste,
  },
  url: {
    label: "From URL",
    description: "Preview one chapter or import a range.",
    icon: Link2,
  },
  epub: {
    label: "EPUB file",
    description: "Import chapters from an EPUB.",
    icon: BookOpen,
  },
};

export function AddChapterSection({
  novelId,
  chapters,
  invalidateChapters,
}: AddChapterSectionProps) {
  const [mode, setMode] = useState<AddChapterMode>("manual");
  const [epubUploadActive, setEpubUploadActive] = useState(false);
  const manualEditor = useManualChapterEditor({ novelId, chapters, invalidateChapters });
  const scrapeImportController: ImportJobController = useImportJob(
    novelId,
    invalidateChapters,
    "scrape",
  );
  const epubImportController: ImportJobController = useImportJob(
    novelId,
    invalidateChapters,
    "epub",
  );
  const handleEpubUploadActivityChange = useCallback((active: boolean) => {
    setEpubUploadActive((current) => (current === active ? current : active));
  }, []);

  const urlImportActive =
    scrapeImportController.importActive || scrapeImportController.startPending;
  const epubImportActive =
    epubImportController.importActive || epubImportController.startPending || epubUploadActive;
  const bulkStartDisabled =
    scrapeImportController.initialStatusLoading ||
    epubImportController.initialStatusLoading ||
    urlImportActive ||
    epubImportActive;

  const handleChapterFetched = (chapter: FetchedChapterDraft) => {
    manualEditor.acceptFetchedChapter(chapter);
    setMode("manual");
  };

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Add chapters</h2>
        <p className="text-sm text-muted-foreground">
          Choose how to bring source chapters into this novel.
        </p>
      </header>

      <Tabs value={mode} onValueChange={(value) => setMode(value as AddChapterMode)}>
        <TabsList className="grid w-full grid-cols-1 gap-2 rounded-none border-0 bg-transparent p-0 min-[640px]:grid-cols-3">
          {(Object.keys(modeDetails) as AddChapterMode[]).map((method) => {
            const detail = modeDetails[method];
            const Icon = detail.icon;
            const running = method === "url" ? urlImportActive : epubImportActive;
            return (
              <TabsTrigger
                key={method}
                value={method}
                className="min-h-28 items-start justify-start rounded-xl border border-border bg-background px-4 py-4 text-left text-foreground hover:bg-muted data-active:border-primary data-active:bg-surface-2 data-active:text-foreground data-active:shadow-none"
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2 text-base font-semibold">
                    {detail.label}
                    {running ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
                        Running
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {detail.description}
                  </span>
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent
          value="manual"
          keepMounted
          className="rounded-2xl border border-border bg-surface p-4 sm:p-6"
        >
          <ManualChapterEditor controller={manualEditor} />
        </TabsContent>

        <TabsContent
          value="url"
          keepMounted
          className="rounded-2xl border border-border bg-surface p-4 sm:p-6"
        >
          <ScrapeImportSection
            novelId={novelId}
            invalidateChapters={invalidateChapters}
            importController={scrapeImportController}
            bulkStartDisabled={bulkStartDisabled}
            onChapterFetched={handleChapterFetched}
            otherImportActive={epubImportActive}
          />
        </TabsContent>

        <TabsContent
          value="epub"
          keepMounted
          className="rounded-2xl border border-border bg-surface p-4 sm:p-6"
        >
          <EpubImportSection
            novelId={novelId}
            importController={epubImportController}
            bulkStartDisabled={bulkStartDisabled}
            onUploadActivityChange={handleEpubUploadActivityChange}
            otherImportActive={urlImportActive}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
