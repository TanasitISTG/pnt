import { useCallback, useState } from "react";
import { BookOpen, ClipboardPaste, Link2 } from "lucide-react";
import { useTranslations } from "use-intl";

import { EpubImportSection } from "@/components/chapters/import/epub-import-section";
import {
  ManualChapterEditor,
  useManualChapterEditor,
  type FetchedChapterDraft,
} from "@/components/chapters/import/manual-chapter-editor";
import { ScrapeImportSection } from "@/components/chapters/import/scrape-import-section";
import { useImportJob } from "@/components/chapters/import/use-import-job";
import type { ImportJobController } from "@/components/chapters/import/use-import-job";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AddChapterMode = "manual" | "url" | "epub";

interface AddChapterSectionProps {
  novelId: string;
  chapters: Array<{ number: string }>;
  invalidateChapters: () => void;
}

// Each mode names its own catalog keys, so the labels live in the catalog and the map stays a
// description of the tab strip rather than a second place copy is written.
const modeDetails: Record<
  AddChapterMode,
  {
    labelKey: "modePaste" | "modeUrl" | "modeEpub";
    descriptionKey: "modePasteDescription" | "modeUrlDescription" | "modeEpubDescription";
    icon: typeof ClipboardPaste;
  }
> = {
  manual: {
    labelKey: "modePaste",
    descriptionKey: "modePasteDescription",
    icon: ClipboardPaste,
  },
  url: {
    labelKey: "modeUrl",
    descriptionKey: "modeUrlDescription",
    icon: Link2,
  },
  epub: {
    labelKey: "modeEpub",
    descriptionKey: "modeEpubDescription",
    icon: BookOpen,
  },
};

/**
 * The three ways to bring source chapters in. The page that renders it owns the title, so
 * this stays a bare section: the studio's add page is this component and nothing else, and
 * two "Add chapters" headings on one screen is one too many.
 */
export function AddChapterSection({
  novelId,
  chapters,
  invalidateChapters,
}: AddChapterSectionProps) {
  const t = useTranslations("studio");
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
      <Tabs value={mode} onValueChange={(value) => setMode(value as AddChapterMode)}>
        <TabsList variant="choice">
          {(Object.keys(modeDetails) as AddChapterMode[]).map((method) => {
            const detail = modeDetails[method];
            const Icon = detail.icon;
            const running = method === "url" ? urlImportActive : epubImportActive;
            return (
              <TabsTrigger key={method} value={method} variant="choice">
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2 text-base font-semibold">
                    {t(detail.labelKey)}
                    {running ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
                        {t("running")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {t(detail.descriptionKey)}
                  </span>
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="manual" keepMounted variant="surface">
          <ManualChapterEditor controller={manualEditor} />
        </TabsContent>

        <TabsContent value="url" keepMounted variant="surface">
          <ScrapeImportSection
            novelId={novelId}
            invalidateChapters={invalidateChapters}
            importController={scrapeImportController}
            bulkStartDisabled={bulkStartDisabled}
            onChapterFetched={handleChapterFetched}
            otherImportActive={epubImportActive}
          />
        </TabsContent>

        <TabsContent value="epub" keepMounted variant="surface">
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
