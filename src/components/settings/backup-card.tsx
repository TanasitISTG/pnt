import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportBackup, importBackup } from "@/lib/backup.functions";

export function BackupCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      const backup = await exportBackup({ data: {} });
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pnt-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Backup exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export backup");
    } finally {
      setExporting(false);
    }
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = await importBackup({ data: { backup: parsed } });
      toast.success(`Imported ${result.importedNovelCount} novel(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import backup");
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data backup</CardTitle>
        <CardDescription>
          Export or import novels, chapters, covers, and glossary terms. API keys are never
          included. Imported novels are created as drafts with new IDs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" onClick={onExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Export JSON"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={importing}
        >
          {importing ? "Importing…" : "Import JSON"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => onImportFile(event.target.files?.[0])}
        />
      </CardContent>
    </Card>
  );
}
