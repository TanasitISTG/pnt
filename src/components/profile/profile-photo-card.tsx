import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/user-avatar";
import type { UpdateProfileImageInput } from "@/lib/profile/schemas";
import type { ResolvedAvatar } from "@/lib/profile/types";
import { cn } from "@/lib/utils";

import { AvatarCropStage } from "./avatar-crop-stage";
import {
  CENTERED_AVATAR_CROP,
  MAX_AVATAR_ZOOM,
  MIN_AVATAR_ZOOM,
  type AvatarCrop,
} from "./avatar-crop";
import { encodeAvatarCrop, stageAvatarFile, type StagedAvatar } from "./avatar-file";

/** Mirrors the server's 2 MiB ceiling; the schema cap is its base64 equivalent. */
export const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface ProfilePhotoCardProps {
  name: string;
  avatar: ResolvedAvatar | null;
  onUpload: (input: UpdateProfileImageInput) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}

/** The one async step in flight, if any; the buttons are disabled while it runs. */
type PendingStep = "reading" | "saving" | "removing" | null;

export function ProfilePhotoCard({ name, avatar, onUpload, onRemove }: ProfilePhotoCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A chosen photo waits here until it is confirmed. Until then the server has not seen
  // it and the shell still shows the stored photo, so cancelling costs nothing.
  const [staged, setStaged] = useState<StagedAvatar | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>(CENTERED_AVATAR_CROP);
  const [pending, setPending] = useState<PendingStep>(null);
  const busy = pending !== null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow picking the same file again after a cancel, a failure or a removal.
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      toast.error("Profile photo must be a JPG, PNG or WebP image");
      return;
    }
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      toast.error("Profile photo must be smaller than 2MB");
      return;
    }

    setPending("reading");
    try {
      setStaged(await stageAvatarFile(file));
      // Every new file starts centered; an earlier adjustment does not carry over.
      setCrop(CENTERED_AVATAR_CROP);
    } catch {
      toast.error("Could not read that image file");
    } finally {
      setPending(null);
    }
  };

  const handleSave = async () => {
    if (!staged) return;
    setPending("saving");

    let upload: UpdateProfileImageInput;
    try {
      upload = await encodeAvatarCrop(staged, crop);
    } catch {
      toast.error("Could not prepare that photo");
      setPending(null);
      return;
    }

    try {
      // A refused upload leaves the adjustment in place, so retrying costs no work.
      if (await onUpload(upload)) setStaged(null);
    } finally {
      setPending(null);
    }
  };

  const handleCancel = () => {
    setStaged(null);
    setCrop(CENTERED_AVATAR_CROP);
  };

  const handleRemove = async () => {
    setPending("removing");
    try {
      await onRemove();
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Camera className="size-5 text-muted-foreground" />
          <CardTitle>Profile Photo</CardTitle>
        </div>
        <CardDescription>Shown next to your name in the app.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={cn("flex flex-wrap gap-6", staged ? "items-start" : "items-center")}>
          {" "}
          {staged ? (
            // The stage is the large avatar's size, so the card does not resize when a
            // photo is staged and the circle is never bigger than what it previews.
            <AvatarCropStage
              staged={staged}
              crop={crop}
              onCropChange={setCrop}
              disabled={pending === "saving"}
            />
          ) : (
            <UserAvatar name={name} avatar={avatar} size="lg" />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_PHOTO_TYPES.join(",")}
              className="hidden"
              aria-label="Profile photo file"
              onChange={handleFileChange}
            />

            {staged ? (
              <>
                <Field className="max-w-xs">
                  <FieldLabel htmlFor="avatarZoom">Zoom</FieldLabel>
                  <Slider
                    id="avatarZoom"
                    aria-label="Zoom"
                    min={MIN_AVATAR_ZOOM}
                    max={MAX_AVATAR_ZOOM}
                    step={0.05}
                    value={[crop.zoom]}
                    disabled={pending === "saving"}
                    onValueChange={(next) =>
                      setCrop((current) => ({
                        ...current,
                        zoom: typeof next === "number" ? next : (next[0] ?? current.zoom),
                      }))
                    }
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={() => void handleSave()} disabled={busy}>
                    {pending === "saving" && <Spinner />}
                    {pending === "saving" ? "Saving…" : "Save photo"}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCancel} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="ghostMuted"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    Choose another
                  </Button>
                </div>
                <p className="text-caption text-muted-foreground">
                  Drag the photo, or nudge it with the arrow keys. Nothing is uploaded until you
                  save.
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    {pending === "reading" ? <Spinner /> : <Camera className="size-4" />}
                    {pending === "reading" ? "Reading…" : avatar ? "Change photo" : "Upload photo"}
                  </Button>
                  {avatar && (
                    <Button
                      type="button"
                      variant="outlineDestructive"
                      onClick={() => void handleRemove()}
                      disabled={busy}
                    >
                      {pending === "removing" && <Spinner />}
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-caption text-muted-foreground">
                  JPG, PNG or WebP up to 2MB. You choose the crop and confirm it before it is
                  uploaded.
                </p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
