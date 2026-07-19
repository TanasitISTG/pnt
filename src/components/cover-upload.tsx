import { useState, useRef, useEffect } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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
  const [preview, setPreview] = useState<string | null>(cover || null);
  const [loading, setLoading] = useState(!cover && hasExistingCover && !!existingNovelId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cover) {
      setPreview(cover);
      setLoading(false);
      return;
    }

    let active = true;
    let objectUrl = "";

    if (hasExistingCover && existingNovelId) {
      async function loadExistingCover() {
        try {
          setLoading(true);
          const response = await fetch(`/api/covers/${existingNovelId}`);
          if (!response.ok) return;
          const blob = await response.blob();
          if (active) {
            objectUrl = URL.createObjectURL(blob);
            setPreview(objectUrl);
          }
        } catch {
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      }
      loadExistingCover();
    }

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [hasExistingCover, existingNovelId, cover]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Cover image must be smaller than 2MB");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setPreview(result);
      const commaIndex = result.indexOf(",");
      const base64Data = commaIndex !== -1 ? result.slice(commaIndex + 1) : result;
      onChange(base64Data, file.type);
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPreview(null);
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
