import { useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { importBackup } from "@/lib/backup.functions";

/**
 * The operator's backup tools.
 *
 * Operator-only on purpose: an export streams every novel and chapter an account owns, and
 * on a metered production database that transfer is the most expensive thing a reader could
 * trigger by accident. The route, the API handler and `importBackup` all refuse a non-operator
 * too — hiding the card is the courtesy, not the control.
 */
export function BackupCard() {
  const t = useTranslations("settings");
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  // Built here rather than at module scope: the message it carries is the reader's own
  // language, and a module-level schema could only say it in one.
  const backupImportSchema = z.object({
    file: z.custom<File>((file) => typeof File !== "undefined" && file instanceof File, {
      message: t("chooseBackupFile"),
    }),
  });
  const importForm = useForm({
    defaultValues: { file: null as File | null },
    validators: { onSubmit: backupImportSchema },
    onSubmit: async ({ value }) => {
      try {
        const parsed: unknown = JSON.parse(await value.file!.text());
        const result = await importBackup({ data: { backup: parsed } });
        toast.success(t("importedNovels", { count: result.importedNovelCount }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("importFailed"));
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
      // The route streams the JSON, so a large library never has to be
      // serialized in memory just to start the download.
      const response = await fetch("/api/backups");
      if (!response.ok) throw new Error(t("exportFailed"));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pnt-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("backupExported"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("backupTitle")}</CardTitle>
        <CardDescription>{t("backupDescription")}</CardDescription>
      </CardHeader>
      {/* Two columns, so the two halves of one job are the same size: side by side on a
          wide card, stacked full width on a narrow one. The form is a grid cell like the
          button beside it, which is what the old `sm:flex-row` row got wrong — the button
          stretched and the wrapped button did not. */}
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          className="w-full"
          onClick={() => void onExport()}
          disabled={exporting}
        >
          {exporting && <Spinner />}
          {exporting ? t("exporting") : t("exportJson")}
        </Button>
        <form
          className="grid"
          onSubmit={(event) => {
            event.preventDefault();
            void importForm.handleSubmit();
          }}
        >
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => inputRef.current?.click()}
            disabled={importing}
          >
            {importing && <Spinner />}
            {importing ? t("importing") : t("importJson")}
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
