import "@tanstack/react-start/server-only";

import { publishState } from "@/lib/content/publish/publish";
import { getPublicStorage } from "@/lib/storage/index.server";
import {
  COVER_WIDTHS,
  COVER_VARIANT_CONTENT_TYPE,
  coverOriginalKey,
  coverPrefix,
  coverVariantKey,
  defaultCoverWidth,
} from "@/lib/storage/keys";
import { nanoid } from "@/lib/utils";

import { resizeCover } from "./cover-image.server";

// Keys embed a fresh random segment per upload, so the bytes at any URL never change.
// Cover caching is therefore a long-lived, immutable rule configured on the public
// bucket's custom domain rather than a per-object Cache-Control header.

export interface ResolvedCover {
  url: string;
  srcSet: string | null;
}

/**
 * Writes the original upload plus every pre-generated variant to the public
 * bucket and returns the key prefix to persist on the novel.
 */
export async function writeCoverSet(
  novelId: string,
  buffer: Uint8Array,
  mime: string,
): Promise<string> {
  const storage = getPublicStorage();
  const prefix = coverPrefix(novelId, nanoid(16));

  await storage.put(coverOriginalKey(prefix), buffer, { contentType: mime });
  for (const width of COVER_WIDTHS) {
    const resized = await resizeCover(buffer, width);
    await storage.put(coverVariantKey(prefix, width), resized, {
      contentType: COVER_VARIANT_CONTENT_TYPE,
    });
  }

  return prefix;
}

/** Removes every object belonging to a cover prefix; a missing prefix is a no-op. */
export async function deleteCoverSet(coverKey: string | null | undefined): Promise<void> {
  if (!coverKey) return;
  await getPublicStorage().deletePrefix(coverKey);
}

/**
 * Resolves the CDN URL for a cover, or null when the novel is not live.
 *
 * Draft and scheduled covers never receive a public URL: the client falls back to
 * the ownership-checked `/api/covers/:novelId` route, so an unpublished cover is
 * only reachable by its owner and its key never leaves the server.
 */
export function resolvePublicCover(
  coverKey: string | null,
  publishedAt: Date | null,
  now: Date = new Date(),
): ResolvedCover | null {
  if (!coverKey) return null;
  if (publishState(publishedAt, now) !== "live") return null;

  const storage = getPublicStorage();
  const widest = coverVariantKey(coverKey, defaultCoverWidth());
  const url = storage.publicUrl(widest);
  if (!url) return null;

  const srcSet = COVER_WIDTHS.map((width) => {
    const variantUrl = storage.publicUrl(coverVariantKey(coverKey, width));
    return variantUrl ? `${variantUrl} ${width}w` : null;
  })
    .filter((entry): entry is string => entry !== null)
    .join(", ");

  return { url, srcSet: srcSet.length > 0 ? srcSet : null };
}
