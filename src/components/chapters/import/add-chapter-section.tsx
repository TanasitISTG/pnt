import { useState } from "react";
import { BookOpen, ClipboardPaste } from "lucide-react";
import { useTranslations } from "use-intl";

import { EpubImportSection } from "@/components/chapters/import/epub-import-section";
import {
  ManualChapterEditor,
  useManualChapterEditor,
} from "@/components/chapters/import/manual-chapter-editor";
import { useImportJob } from "@/components/chapters/import/use-import-job";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AddChapterMode = "manual" | "epub";

interface AddChapterSectionProps {
  novelId: string;
  chapters: Array<{ number: string }>;
  invalidateChapters: () => void;
}

/**
 * Two ways in: type or paste one chapter, or unpack an archive. The mode switch is a compact
 * two-item strip rather than a row of cards — with the URL source gone there are only two
 * choices, and the work itself deserves the space the picker used to take.
 */
export function AddChapterSection({
  novelId,
  chapters,
  invalidateChapters,
}: AddChapterSectionProps) {
  const t = useTranslations("studio");
  const [mode, setMode] = useState<AddChapterMode>("manual");
  const manualEditor = useManualChapterEditor({ novelId, chapters, invalidateChapters });
  const epubImportController = useImportJob(novelId, invalidateChapters);

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <Tabs value={mode} onValueChange={(value) => setMode(value as AddChapterMode)}>
        <TabsList className="grid w-full grid-cols-2 sm:w-fit sm:min-w-80">
          <TabsTrigger value="manual">
            <ClipboardPaste className="size-4" aria-hidden="true" />
            {t("modePaste")}
          </TabsTrigger>
          <TabsTrigger value="epub">
            <BookOpen className="size-4" aria-hidden="true" />
            {t("modeEpub")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual" keepMounted variant="surface">
          <ManualChapterEditor controller={manualEditor} />
        </TabsContent>

        <TabsContent value="epub" keepMounted variant="surface">
          <EpubImportSection novelId={novelId} importController={epubImportController} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
