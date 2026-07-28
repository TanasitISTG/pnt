import { useState } from "react";
import { toast } from "sonner";
import { exportNovelEpub, exportNovelTxt } from "@/lib/export.functions";
import { downloadBase64, downloadText } from "@/lib/download";

export function useNovelExport(novelId: string) {
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

  return { exporting, handleExportTxt, handleExportEpub };
}
