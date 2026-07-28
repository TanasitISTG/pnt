import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { blobToDataUrl } from "@/lib/utils";

interface CoverUploadProps {
  existingNovelId?: string | null;
  hasExistingCover?: boolean;
  cover?: string | null;
  onChange: (base64: string | null, mimeType: string | null) => void;
  onRemoveCover?: () => void;
}

export function CoverUpload({
  existingNovelId,
  hasExistingCover = false,
  cover,
  onChange,
  onRemoveCover,
}: CoverUploadProps) {
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // Set on explicit remove so a cached existing cover never reappears.
  const [removed, setRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // useQuery owns the fetch: dedupes mounts, no manual race guard.
  // retry: false — a missing cover just shows the upload button.
  const wantsExisting =
    !removed && !cover && !localPreview && hasExistingCover && !!existingNovelId;
  const { data: existingCover, isPending } = useQuery({
    queryKey: ["cover", existingNovelId],
    queryFn: async () => {
      const response = await fetch(`/api/covers/${existingNovelId}`);
      if (!response.ok) throw new Error("Failed to load cover");
      // data URL instead of an object URL: nothing to revoke, no Blob pin.
      return blobToDataUrl(await response.blob());
    },
    enabled: wantsExisting,
    retry: false,
    staleTime: 0, // refetch on mount, matching the old per-mount effect
  });
  const preview = cover || localPreview || (wantsExisting ? (existingCover ?? null) : null);
  const loading = wantsExisting && isPending;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Cover image must be smaller than 2MB");
      return;
    }

    // Downscale + re-encode once at upload so every guest fetch is a small WebP.
    const img = new Image();
    // once: true — listeners self-remove after firing, nothing to clean up.
    img.addEventListener(
      "load",
      () => {
        const scale = Math.min(1, 800 / img.naturalWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL("image/webp", 0.8);
        // Old Safari silently falls back to PNG when it can't encode WebP.
        const mime = result.startsWith("data:image/webp") ? "image/webp" : "image/png";
        setLocalPreview(result);
        onChange(result.slice(result.indexOf(",") + 1), mime);
      },
      { once: true },
    );
    img.addEventListener(
      "error",
      () => {
        toast.error("Could not read that image file");
      },
      { once: true },
    );
    img.src = await blobToDataUrl(file);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalPreview(null);
    setRemoved(true);
    onChange(null, null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onRemoveCover?.();
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />
      {loading ? (
        <div className="aspect-3/4 w-48 rounded-xl border border-border bg-foreground/5 animate-pulse" />
      ) : preview ? (
        <div className="relative group/cover aspect-3/4 w-48 overflow-hidden rounded-xl border border-border bg-muted">
          <img src={preview} alt="Novel Cover Preview" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/cover:opacity-100">
            <div className="flex gap-2">
              <Button variant="cream" size="sm" onClick={() => fileInputRef.current?.click()}>
                Change
              </Button>
              <Button variant="destructive" size="sm" onClick={handleRemove}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex aspect-3/4 w-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/20 bg-foreground/3 transition-colors hover:bg-foreground/5 text-muted-foreground hover:text-foreground text-center"
        >
          <Upload className="size-6" />
          <span className="text-caption">
            Upload Cover
            <br />
            (Max 2MB)
          </span>
        </button>
      )}
    </div>
  );
}
