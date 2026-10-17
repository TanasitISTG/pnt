import { useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { ChapterImportStatus } from "@/components/chapters/import/chapter-import-status";
import type { ImportJobController } from "@/components/chapters/import/use-import-job";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  abortEpubUpload,
  completeEpubUpload,
  createEpubUpload,
  EPUB_CONTENT_TYPE,
} from "@/lib/epub/functions";
import { encodeMessage } from "@/lib/i18n/message-code";

interface EpubImportSectionProps {
  novelId: string;
  importController: ImportJobController;
  bulkStartDisabled: boolean;
  onUploadActivityChange: (active: boolean) => void;
  otherImportActive: boolean;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB

interface UploadProgress {
  percent: number;
}

/**
 * Sends the archive straight to object storage through the presigned URL. XHR is
 * deliberate: fetch cannot report upload progress, and the file is too large for a
 * server-function body on the platform bound.
 */
function putEpubWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
  failureMessage: string,
  cancelledMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", EPUB_CONTENT_TYPE);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(failureMessage));
    });
    request.addEventListener("error", () => reject(new Error(failureMessage)));
    request.addEventListener("abort", () => reject(new Error(cancelledMessage)));
    request.send(file);
  });
}

const epubFileSchema = z.custom<File | null>(
  (value) => value === null || (typeof File !== "undefined" && value instanceof File),
  encodeMessage("validation.epubFileInvalid"),
);
const epubImportFormSchema = z.object({
  epubFile: epubFileSchema.superRefine((file, context) => {
    if (!file) {
      context.addIssue({ code: "custom", message: encodeMessage("validation.epubFileRequired") });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".epub")) {
      context.addIssue({ code: "custom", message: encodeMessage("validation.epubFileInvalid") });
    } else if (file.size === 0) {
      context.addIssue({ code: "custom", message: encodeMessage("validation.epubFileEmpty") });
    } else if (file.size > MAX_FILE_SIZE) {
      context.addIssue({ code: "custom", message: encodeMessage("validation.epubFileTooLarge") });
    }
  }),
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EpubImportSection({
  novelId,
  importController,
  bulkStartDisabled,
  onUploadActivityChange,
  otherImportActive,
}: EpubImportSectionProps) {
  const t = useTranslations("studio");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  const form = useForm({
    defaultValues: {
      epubFile: null as File | null,
    },
    validators: {
      onSubmit: epubImportFormSchema,
    },
    onSubmit: async ({ value }) => {
      const parsed = epubImportFormSchema.parse(value);
      const file = parsed.epubFile;
      if (!file) return;

      setUploadError(null);
      setUploadProgress({ percent: 0 });
      let uploadId: string | null = null;

      try {
        const createResult = await createEpubUpload({
          data: {
            novelId,
            fileName: file.name,
            fileSize: file.size,
          },
        });
        uploadId = createResult.uploadId;

        await putEpubWithProgress(
          createResult.uploadUrl,
          file,
          (percent) => {
            setUploadProgress({ percent });
          },
          t("epubUploadFailed"),
          t("epubUploadCancelled"),
        );

        const { jobId } = await completeEpubUpload({ data: { uploadId } });
        importController.attachJob(jobId, file.name);
        toast.info(t("epubQueued"));
      } catch (error: unknown) {
        if (uploadId) {
          await abortEpubUpload({ data: { uploadId } }).catch(() => {});
        }
        setUploadError(error instanceof Error ? error.message : t("epubUploadFallback"));
      } finally {
        uploadingRef.current = false;
        setUploadProgress(null);
        onUploadActivityChange(false);
      }
    },
  });

  const [selectedFile, isSubmitting] = useStore(
    form.store,
    (state) => [state.values.epubFile, state.isSubmitting] as const,
    (previous, next) => previous[0] === next[0] && previous[1] === next[1],
  );
  const clearFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleSelectedFile = (file: File | undefined) => {
    if (!file) return;
    const result = epubImportFormSchema.shape.epubFile.safeParse(file);
    if (!result.success) {
      form.setFieldMeta("epubFile", (previous) => ({
        ...previous,
        isTouched: true,
        errorMap: { ...previous.errorMap, onChange: result.error.issues[0] },
      }));
      clearFileInput();
      return;
    }
    form.setFieldValue("epubFile", result.data);
    form.setFieldMeta("epubFile", (previous) => ({
      ...previous,
      errorMap: { ...previous.errorMap, onChange: undefined },
    }));
    setUploadError(null);
    clearFileInput();
  };
  const beginUploadAndImport = () => {
    if (
      uploadingRef.current ||
      bulkStartDisabled ||
      importController.importActive ||
      importController.startPending ||
      otherImportActive
    ) {
      return;
    }
    const result = epubImportFormSchema.safeParse(form.state.values);
    if (!result.success) {
      void form.handleSubmit();
      return;
    }
    uploadingRef.current = true;
    onUploadActivityChange(true);
    void form.handleSubmit();
  };

  const selectionDisabled =
    bulkStartDisabled ||
    isSubmitting ||
    importController.importActive ||
    importController.startPending ||
    otherImportActive;
  const retryableJob =
    importController.importJob &&
    (importController.importJob.status === "error" ||
      importController.importJob.status === "cancelled")
      ? importController.importJob
      : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold tracking-tight text-foreground">{t("epubHeading")}</h3>
        <p className="text-sm text-muted-foreground">{t("epubLead")}</p>
      </header>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          beginUploadAndImport();
        }}
        className="flex flex-col gap-6"
      >
        <form.Field name="epubFile">
          {(field) => {
            const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="epub-file-input" className="sr-only">
                  {t("epubFileLabel")}
                </FieldLabel>
                <input
                  ref={fileInputRef}
                  type="file"
                  name={field.name}
                  autoComplete="off"
                  accept=".epub,application/epub+zip"
                  onBlur={field.handleBlur}
                  onChange={(event) => handleSelectedFile(event.target.files?.[0])}
                  disabled={selectionDisabled}
                  className="sr-only"
                  id="epub-file-input"
                  aria-label={t("epubFileLabel")}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? "epub-file-error" : undefined}
                />

                {selectedFile ? (
                  <div
                    className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4"
                    role="group"
                    aria-label={t("selectedEpubFile")}
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span
                        className="truncate text-base font-semibold text-foreground"
                        title={selectedFile.name}
                      >
                        {selectedFile.name}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatFileSize(selectedFile.size)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={selectionDisabled}
                      >
                        {t("replaceFile")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          field.handleChange(null);
                          setUploadError(null);
                          clearFileInput();
                        }}
                        disabled={selectionDisabled}
                      >
                        {t("removeFile")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center text-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ${
                      dragActive
                        ? "border-primary bg-surface-2"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!selectionDisabled) setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      if (!selectionDisabled) handleSelectedFile(event.dataTransfer.files?.[0]);
                    }}
                    disabled={selectionDisabled}
                  >
                    <span className="text-base font-semibold">{t("epubDropTitle")}</span>
                    <span className="text-sm text-muted-foreground">{t("epubDropHint")}</span>
                  </button>
                )}
                {invalid && <FieldError id="epub-file-error" errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>

        {otherImportActive ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("finishUrlImport")}
          </p>
        ) : null}

        {uploadProgress ? (
          <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <Progress
              value={uploadProgress.percent}
              aria-label={t("epubUploadProgressLabel")}
              className="gap-2"
            >
              <div className="flex w-full items-center gap-3 text-sm text-muted-foreground">
                <ProgressLabel>{t("uploadingEpub")}</ProgressLabel>
                <ProgressValue>{() => `${uploadProgress.percent}%`}</ProgressValue>
              </div>
            </Progress>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            disabled={!selectedFile || selectionDisabled || bulkStartDisabled || isSubmitting}
            className="self-start"
          >
            {isSubmitting && <Spinner />}
            {isSubmitting
              ? t("epubUploadingPercent", { percent: uploadProgress?.percent ?? 0 })
              : t("uploadAndImport")}
          </Button>
          {uploadError ? (
            <div
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive-text"
              role="alert"
            >
              {uploadError}
            </div>
          ) : null}
        </div>
      </form>

      <ChapterImportStatus
        label={t("importLabelEpub")}
        job={importController.importJob}
        active={importController.importActive}
        statusError={importController.importStatusError}
        onRetryStatus={importController.retryImportStatus}
      />

      {importController.importActive ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={importController.cancelImport}
        >
          {t("cancelImport")}
        </Button>
      ) : null}

      {retryableJob ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">
            {selectedFile ? t("importStoppedReupload") : t("importChooseEpubAgain")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={beginUploadAndImport}
            disabled={
              !selectedFile ||
              bulkStartDisabled ||
              selectionDisabled ||
              importController.startPending
            }
          >
            {t("retryEpubImport")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
