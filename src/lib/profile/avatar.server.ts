import "@tanstack/react-start/server-only";

import { getPublicStorage } from "@/lib/storage/index.server";
import {
  AVATAR_VARIANT_CONTENT_TYPE,
  AVATAR_WIDTHS,
  avatarOriginalKey,
  avatarPrefix,
  avatarProxyPath,
  avatarVariantKey,
  defaultAvatarWidth,
  parseAvatarPrefix,
} from "@/lib/storage/keys";
import { nanoid } from "@/lib/utils";

import { resizeAvatar } from "./avatar-image.server";
import type { ResolvedAvatar } from "./types";

// Avatars live in the public bucket beside covers: guests will see them on
// comments and author bylines. Each upload gets a fresh unguessable segment, so
// the bytes behind a URL never change and the bucket's long-lived cache rule can
// apply without any purge step.

/**
 * Writes the original upload plus every square variant and returns the key prefix
 * to persist on the user.
 */
export async function writeAvatarSet(
  userId: string,
  buffer: Uint8Array,
  mime: string,
): Promise<string> {
  const storage = getPublicStorage();
  const prefix = avatarPrefix(userId, nanoid(16));

  await storage.put(avatarOriginalKey(prefix), buffer, { contentType: mime });
  for (const width of AVATAR_WIDTHS) {
    const resized = await resizeAvatar(buffer, width);
    await storage.put(avatarVariantKey(prefix, width), resized, {
      contentType: AVATAR_VARIANT_CONTENT_TYPE,
    });
  }

  return prefix;
}

/** Removes every object belonging to an avatar prefix; a missing prefix is a no-op. */
export async function deleteAvatarSet(imageKey: string | null | undefined): Promise<void> {
  if (!imageKey) return;
  await getPublicStorage().deletePrefix(imageKey);
}

/**
 * Resolves the URL a browser should load for a stored avatar key.
 *
 * When the bucket has a public origin the variants come straight from the CDN.
 * The filesystem adapter (local dev, CI) has no origin and reports none, so the
 * response falls back to the app's own route — whose path carries the unguessable
 * segment, keeping every avatar URL immutable in both cases.
 */
export function resolveUserAvatar(imageKey: string | null): ResolvedAvatar | null {
  if (!imageKey) return null;
  const parsed = parseAvatarPrefix(imageKey);
  if (!parsed) return null;

  const storage = getPublicStorage();
  const variantUrl = (width: (typeof AVATAR_WIDTHS)[number]): string =>
    storage.publicUrl(avatarVariantKey(imageKey, width)) ??
    avatarProxyPath(parsed.userId, parsed.segment, width);

  const srcSet = AVATAR_WIDTHS.map((width) => `${variantUrl(width)} ${width}w`).join(", ");
  return { url: variantUrl(defaultAvatarWidth()), srcSet: srcSet.length > 0 ? srcSet : null };
}
