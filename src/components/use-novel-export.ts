import { useState } from "react";
import { toast } from "sonner";
import { downloadUrl } from "@/lib/download";

export function useNovelExport(novelId: string) {
  const [exporting, setExporting] = useState<"txt" | "epub" | null>(null);

  const exportNovel = async (format: "txt" | "epub") => {
    setExporting(format);
    try {
      const url = `/api/exports/${encodeURIComponent(novelId)}/${format}`;
      const response = await fetch(url, { method: "HEAD" });
      if (!response.ok) {
        throw new Error(
          response.status === 404 ? "No translated chapters to export yet" : "Export failed",
        );
      }
      downloadUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const handleExportTxt = () => exportNovel("txt");
  const handleExportEpub = () => exportNovel("epub");

  return { exporting, handleExportTxt, handleExportEpub };
}
