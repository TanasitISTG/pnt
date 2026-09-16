import { useRef, useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { ChapterImportStatus } from "@/components/chapters/chapter-import-status";
import type { ImportJobController } from "@/components/chapters/use-import-job";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  abortEpubUpload,
  completeEpubUpload,
  createEpubUpload,
  uploadEpubChunk,
} from "@/lib/epub/functions";
import { blobToDataUrl } from "@/lib/utils";

interface EpubImportSectionProps {
  novelId: string;
  importController: ImportJobController;
  bulkStartDisabled: boolean;
  onUploadActivityChange: (active: boolean) => void;
  otherImportActive: boolean;
}

const CHUNK_SIZE = 1024 * 1024; // 1 MiB
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB

interface UploadProgress {
  currentChunk: number;
  totalChunks: number;
  percent: number;
}

const epubFileSchema = z.custom<File | null>(
  (value) => value === null || (typeof File !== "undefined" && value instanceof File),
  "Please select a valid .epub file",
);
const epubImportFormSchema = z.object({
  epubFile: epubFileSchema.superRefine((file, context) => {
    if (!file) {
      context.addIssue({ code: "custom", message: "Please select an EPUB file" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".epub")) {
      context.addIssue({ code: "custom", message: "Please select a valid .epub file" });
    } else if (file.size === 0) {
      context.addIssue({ code: "custom", message: "Selected file is empty" });
    } else if (file.size > MAX_FILE_SIZE) {
      context.addIssue({ code: "custom", message: "EPUB file must be 50 MB or smaller" });
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

      const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
      setUploadError(null);
      setUploadProgress({ currentChunk: 0, totalChunks: chunkCount, percent: 0 });
      let uploadId: string | null = null;

      try {
        const createResult = await createEpubUpload({
          data: {
            novelId,
            fileName: file.name,
            fileSize: file.size,
            chunkCount,
          },
        });
        uploadId = createResult.uploadId;

        // The upload protocol intentionally stays sequential for deterministic recovery.
        for (let index = 0; index < chunkCount; index += 1) {
          const start = index * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const slice = file.slice(start, end);
          const dataUrl = await blobToDataUrl(slice);
          const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
          await uploadEpubChunk({
            data: {
              uploadId,
              chunkIndex: index,
              dataBase64,
            },
          });

          const currentChunk = index + 1;
          setUploadProgress({
            currentChunk,
            totalChunks: chunkCount,
            percent: Math.round((currentChunk / chunkCount) * 100),
          });
        }

        const { jobId } = await completeEpubUpload({ data: { uploadId } });
        importController.attachJob(jobId, file.name);
        toast.info("EPUB uploaded and import queued (runs server-side)");
      } catch (error: unknown) {
        if (uploadId) {
          await abortEpubUpload({ data: { uploadId } }).catch(() => {});
        }
        setUploadError(error instanceof Error ? error.message : "Failed to upload EPUB");
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
        <h3 className="text-xl font-semibold tracking-tight text-foreground">
          Import an EPUB file
        </h3>
        <p className="text-sm text-muted-foreground">
          Import raw chapters from a WebToEpub or standard .epub file.
        </p>
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
                  EPUB file
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
                  aria-label="EPUB file"
                  aria-invalid={invalid}
                  aria-describedby={invalid ? "epub-file-error" : undefined}
                />

                {selectedFile ? (
                  <div
                    className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4"
                    role="group"
                    aria-label="Selected EPUB file"
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
                        Replace file
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
                        Remove file
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ${
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
                    <span className="text-base font-semibold">
                      Drop an EPUB here or choose a file
                    </span>
                    <span className="text-sm text-muted-foreground">
                      WebToEpub and standard .epub files, up to 50 MB.
                    </span>
                  </button>
                )}
                {invalid && <FieldError id="epub-file-error" errors={field.state.meta.errors} />}
              </Field>
            );
          }}
        </form.Field>

        {otherImportActive ? (
          <p className="text-sm text-muted-foreground" role="status">
            Finish or cancel the URL range import before starting an EPUB import.
          </p>
        ) : null}

        {uploadProgress ? (
          <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <Progress
              value={uploadProgress.percent}
              aria-label="EPUB upload progress"
              className="gap-2"
            >
              <div className="flex w-full items-center gap-3 text-sm text-muted-foreground">
                <ProgressLabel>
                  Uploading chunk {uploadProgress.currentChunk} of {uploadProgress.totalChunks}
                </ProgressLabel>
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
            {isSubmitting ? `Uploading ${uploadProgress?.percent ?? 0}%…` : "Upload and import"}
          </Button>
          {uploadError ? (
            <div
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {uploadError}
            </div>
          ) : null}
        </div>
      </form>

      <ChapterImportStatus
        label="EPUB import"
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
          Cancel import
        </Button>
      ) : null}

      {retryableJob ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground">
            {selectedFile
              ? "This import stopped. Upload the selected EPUB again to retry."
              : "Choose the EPUB file again before retrying this import."}
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
            Retry EPUB import
          </Button>
        </div>
      ) : null}
    </div>
  );
}
