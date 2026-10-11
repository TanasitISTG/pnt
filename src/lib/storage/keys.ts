// Pure object-key helpers for the storage layer. No I/O, no server-only imports:
// keys are derivable in tests and from the client-visible URL shape.

/** Cover variants generated at upload time and served from the public bucket. */
export const COVER_WIDTHS = [320, 480, 640] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];

/** Object holding the untouched upload, kept so new widths can be derived later. */
export const COVER_ORIGINAL_NAME = "original";
export const COVER_VARIANT_CONTENT_TYPE = "image/webp";
/** Public bucket prefix. Must stay in sync with the bucket lifecycle rules. */
export const COVER_KEY_ROOT = "covers";
export const EPUB_UPLOAD_KEY_ROOT = "epub-uploads";
export const EXPORT_KEY_ROOT = "exports";
/** Bumping this invalidates every cached export. */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * `covers/<novelId>/<segment>` carries an unguessable segment so a replaced cover
 * gets a fresh URL: no purge, no cache-busting query, no stale CDN bytes.
 */
export function coverPrefix(novelId: string, segment: string): string {
  return `${COVER_KEY_ROOT}/${novelId}/${segment}`;
}

export function coverObjectKey(prefix: string, name: string): string {
  return `${prefix}/${name}`;
}

export function coverVariantKey(prefix: string, width: CoverWidth): string {
  return coverObjectKey(prefix, `${width}.webp`);
}

/** The widest variant, served when a caller does not ask for a specific width. */
export function defaultCoverWidth(): CoverWidth {
  return COVER_WIDTHS[COVER_WIDTHS.length - 1];
}

export function coverOriginalKey(prefix: string): string {
  return coverObjectKey(prefix, COVER_ORIGINAL_NAME);
}

export function epubUploadKey(uploadId: string): string {
  return `${EPUB_UPLOAD_KEY_ROOT}/${uploadId}`;
}

export interface ExportRevisionInput {
  format: "txt" | "epub";
  novelTitle: string;
  novelAuthor: string | null;
  targetLang: string;
  chapterCount: number;
  maxChapterUpdatedAt: Date | string | null;
  maxTranslationGeneration: number;
}

/**
 * Cheap content fingerprint. Every input feeds the export body, so a stable token
 * means the cached object is still current — and cover or publication edits, which
 * the body does not depend on, deliberately do not invalidate it.
 */
export function exportRevision(input: ExportRevisionInput): string {
  const parts = [
    `v${EXPORT_FORMAT_VERSION}`,
    input.format,
    input.novelTitle,
    input.novelAuthor ?? "",
    input.targetLang,
    input.chapterCount,
    input.maxChapterUpdatedAt === null ? "none" : toEpoch(input.maxChapterUpdatedAt),
    input.maxTranslationGeneration,
  ];
  return fnv1a(parts.join("|"));
}

function toEpoch(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

// 32-bit FNV-1a, hex-encoded. A cache key only needs collision resistance across
// one novel's export history, not cryptographic strength.
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function exportObjectKey(novelId: string, revision: string, format: "txt" | "epub"): string {
  return `${EXPORT_KEY_ROOT}/${novelId}/${revision}.${format}`;
}

export function exportKeyPrefix(novelId: string): string {
  return `${EXPORT_KEY_ROOT}/${novelId}/`;
}
