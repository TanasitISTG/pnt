import { useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { exportBackup, importBackup } from "@/lib/backup.functions";

const backupImportSchema = z.object({
  file: z.custom<File>((file) => typeof File !== "undefined" && file instanceof File, {
    message: "Choose a JSON backup file",
  }),
});

export function BackupCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const importForm = useForm({
    defaultValues: { file: null as File | null },
    validators: { onSubmit: backupImportSchema },
    onSubmit: async ({ value }) => {
      try {
        const parsed: unknown = JSON.parse(await value.file!.text());
        const result = await importBackup({ data: { backup: parsed } });
        toast.success(`Imported ${result.importedNovelCount} novel(s)`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to import backup");
      } finally {
        importForm.reset();
        if (inputRef.current) inputRef.current.value = "";
      }
    },
  });
  const importing = useStore(importForm.store, (state) => state.isSubmitting);

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
        <Button type="button" onClick={() => void onExport()} disabled={exporting}>
          {exporting && <Spinner />}
          {exporting ? "Exporting…" : "Export JSON"}
        </Button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void importForm.handleSubmit();
          }}
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={importing}
          >
            {importing && <Spinner />}
            {importing ? "Importing…" : "Import JSON"}
          </Button>
          <importForm.Field name="file">
            {(field) => (
              <input
                ref={inputRef}
                name={field.name}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  field.handleChange(event.target.files?.[0] ?? null);
                  void importForm.handleSubmit();
                }}
              />
            )}
          </importForm.Field>
        </form>
      </CardContent>
    </Card>
  );
}
