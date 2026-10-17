import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { downloadUrl } from "@/lib/download";

/**
 * Export a novel as TXT or EPUB, through the app's own streaming route.
 *
 * The route answers a preflight with the status alone, so a novel with nothing translated to export
 * is a 404 the reader hears about before a download starts. Both sentences are keys because a toast
 * is read by a reader and this hook is a module with no language of its own.
 */
export function useNovelExport(novelId: string) {
  const t = useTranslations("studio");
  const [exporting, setExporting] = useState<"txt" | "epub" | null>(null);

  const exportNovel = async (format: "txt" | "epub") => {
    setExporting(format);
    try {
      const url = `/api/exports/${encodeURIComponent(novelId)}/${format}`;
      const response = await fetch(url, { method: "HEAD" });
      if (!response.ok) {
        toast.error(response.status === 404 ? t("exportNovelNoChapters") : t("exportNovelFailed"));
        return;
      }
      downloadUrl(url);
    } catch {
      toast.error(t("exportNovelFailed"));
    } finally {
      setExporting(null);
    }
  };

  const handleExportTxt = () => exportNovel("txt");
  const handleExportEpub = () => exportNovel("epub");

  return { exporting, handleExportTxt, handleExportEpub };
}
