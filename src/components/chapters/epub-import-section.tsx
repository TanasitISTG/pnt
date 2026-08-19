import { useState, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createEpubUpload,
  uploadEpubChunk,
  completeEpubUpload,
  abortEpubUpload,
} from "@/lib/epub/functions";
import { useImportJob } from "@/components/chapters/use-import-job";
import { blobToDataUrl } from "@/lib/utils";

interface EpubImportSectionProps {
  novelId: string;
  invalidateChapters: () => void;
}

const CHUNK_SIZE = 1024 * 1024; // 1 MiB
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EpubImportSection({ novelId, invalidateChapters }: EpubImportSectionProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    currentChunk: number;
    totalChunks: number;
    percent: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { importJob, importActive, cancelImport, attachJob } = useImportJob(
    novelId,
    invalidateChapters,
    "epub",
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".epub")) {
      toast.error("Please select a valid .epub file");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error("EPUB file must be 50 MB or smaller");
      return;
    }

    if (file.size === 0) {
      toast.error("Selected file is empty");
      return;
    }

    setSelectedFile(file);
  };

  const handleUploadAndImport = async () => {
    if (!selectedFile || uploading || importActive) return;

    const file = selectedFile;
    const chunkCount = Math.ceil(file.size / CHUNK_SIZE);

    setUploading(true);
    setUploadProgress({ currentChunk: 0, totalChunks: chunkCount, percent: 0 });

    let uploadId: string | null = null;

    try {
      // 1. Initialize upload session
      const createRes = await createEpubUpload({
        data: {
          novelId,
          fileName: file.name,
          fileSize: file.size,
          chunkCount,
        },
      });

      uploadId = createRes.uploadId;

      // Preserve ordered progress and stop before sending later chunks after a failure.
      // The upload protocol intentionally trades throughput for deterministic recovery.
      // 2. Upload chunks sequentially
      for (let i = 0; i < chunkCount; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const slice = file.slice(start, end);
        const dataUrl = await blobToDataUrl(slice);
        const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

        await uploadEpubChunk({
          data: {
            uploadId,
            chunkIndex: i,
            dataBase64,
          },
        });

        const uploadedChunks = i + 1;
        const percent = Math.round((uploadedChunks / chunkCount) * 100);
        setUploadProgress({
          currentChunk: uploadedChunks,
          totalChunks: chunkCount,
          percent,
        });
      }

      // 3. Complete upload & queue Inngest import job
      const { jobId } = await completeEpubUpload({
        data: { uploadId },
      });

      attachJob(jobId, file.name);
      toast.info("EPUB uploaded and import queued (runs server-side)");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      if (uploadId) {
        await abortEpubUpload({ data: { uploadId } }).catch(() => {});
      }
      const msg = err instanceof Error ? err.message : "Failed to upload EPUB";
      toast.error(msg);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const isBusy = uploading || importActive;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted p-4 mb-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label className="text-sub font-semibold text-foreground">Import from EPUB</Label>
          {importActive && (
            <span className="text-caption text-primary font-medium">
              (runs server-side — safe to close this tab)
            </span>
          )}
        </div>
        <p className="text-caption text-muted-foreground">
          Upload a WebToEpub or standard .epub file (up to 50 MB) to import raw chapters into this
          novel.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub,application/epub+zip"
          onChange={handleFileChange}
          disabled={isBusy}
          className="hidden"
          id="epub-file-input"
        />

        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          size="sm"
        >
          {selectedFile ? "Change File" : "Select .epub"}
        </Button>

        {selectedFile && (
          <span
            className="text-caption text-foreground truncate max-w-[260px]"
            title={selectedFile.name}
          >
            {selectedFile.name} ({formatFileSize(selectedFile.size)})
          </span>
        )}

        <Button
          type="button"
          onClick={handleUploadAndImport}
          disabled={!selectedFile || isBusy}
          size="sm"
          className="ml-auto"
        >
          {uploading ? `Uploading (${uploadProgress?.percent ?? 0}%)` : "Upload & Import EPUB"}
        </Button>

        {importActive && (
          <Button type="button" variant="destructive" size="sm" onClick={cancelImport}>
            Cancel Import
          </Button>
        )}
      </div>

      {uploadProgress && (
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex justify-between text-caption text-muted-foreground">
            <span>
              Uploading chunk {uploadProgress.currentChunk} of {uploadProgress.totalChunks}
            </span>
            <span>{uploadProgress.percent}%</span>
          </div>
          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {importJob && (
        <div className="flex flex-col gap-1 rounded bg-background/50 p-2.5 text-caption border border-border/50">
          <div className="flex items-center justify-between font-medium">
            <span className="capitalize text-foreground">
              Status: {importJob.status}
              {importJob.sourceFileName ? ` (${importJob.sourceFileName})` : ""}
            </span>
            {importJob.status === "running" && (
              <span className="text-muted-foreground">
                {importJob.toNumber === 0
                  ? "Preparing EPUB…"
                  : `Chapter ${importJob.nextNumber - 1} / ${importJob.toNumber}`}
              </span>
            )}
          </div>

          {importJob.toNumber === 0 && importActive && (
            <p className="text-muted-foreground">Extracting and parsing EPUB chapters on server…</p>
          )}

          {importJob.toNumber > 0 && (
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>
                Added: <strong className="text-foreground">{importJob.added}</strong>
              </span>
              <span>
                Skipped: <strong className="text-foreground">{importJob.skipped}</strong>
              </span>
              <span>
                Failed: <strong className="text-foreground">{importJob.failed}</strong>
              </span>
            </div>
          )}

          {importJob.error && (
            <p className="text-destructive font-medium">Error: {importJob.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
