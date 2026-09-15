import { useRef, useState } from "react";
import { toast } from "sonner";

import { ChapterImportStatus } from "@/components/chapters/chapter-import-status";
import type { ImportJobController } from "@/components/chapters/use-import-job";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateEpubFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".epub")) return "Please select a valid .epub file";
  if (file.size === 0) return "Selected file is empty";
  if (file.size > MAX_FILE_SIZE) return "EPUB file must be 50 MB or smaller";
  return null;
}

export function EpubImportSection({
  novelId,
  importController,
  bulkStartDisabled,
  onUploadActivityChange,
  otherImportActive,
}: EpubImportSectionProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  const selectionDisabled =
    bulkStartDisabled ||
    uploading ||
    importController.importActive ||
    importController.startPending ||
    otherImportActive;

  const clearFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSelectedFile = (file: File | undefined) => {
    if (!file) return;
    const validationError = validateEpubFile(file);
    if (validationError) {
      setFileError(validationError);
      clearFileInput();
      return;
    }
    setSelectedFile(file);
    setFileError(null);
    setUploadError(null);
    clearFileInput();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleSelectedFile(event.target.files?.[0]);
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (selectionDisabled) return;
    handleSelectedFile(event.dataTransfer.files?.[0]);
  };

  const handleUploadAndImport = async () => {
    if (!selectedFile || selectionDisabled || bulkStartDisabled || uploadingRef.current) {
      return;
    }

    const file = selectedFile;
    const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
    uploadingRef.current = true;
    setUploadError(null);
    setUploading(true);
    setUploadProgress({ currentChunk: 0, totalChunks: chunkCount, percent: 0 });
    onUploadActivityChange(true);

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
      setUploading(false);
      setUploadProgress(null);
      onUploadActivityChange(false);
    }
  };

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

      <input
        ref={fileInputRef}
        type="file"
        name="epubFile"
        autoComplete="off"
        accept=".epub,application/epub+zip"
        onChange={handleFileChange}
        disabled={selectionDisabled}
        className="sr-only"
        id="epub-file-input"
        aria-label="EPUB file"
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
                setSelectedFile(null);
                setFileError(null);
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
          className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ${
            dragActive
              ? "border-primary bg-surface-2 text-foreground"
              : "border-border bg-background text-foreground hover:bg-muted"
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!selectionDisabled) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          disabled={selectionDisabled}
        >
          <span className="text-base font-semibold">Drop an EPUB here or choose a file</span>
          <span className="text-sm text-muted-foreground">
            WebToEpub and standard .epub files, up to 50 MB.
          </span>
        </button>
      )}

      {otherImportActive ? (
        <p className="text-sm text-muted-foreground" role="status">
          Finish or cancel the URL range import before starting an EPUB import.
        </p>
      ) : null}
      {fileError ? (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {fileError}
        </div>
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
          type="button"
          onClick={() => void handleUploadAndImport()}
          disabled={!selectedFile || selectionDisabled || bulkStartDisabled}
          className="self-start"
        >
          {uploading ? `Uploading ${uploadProgress?.percent ?? 0}%…` : "Upload and import"}
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
            onClick={() => void handleUploadAndImport()}
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
