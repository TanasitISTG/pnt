// Pure object-key helpers for the storage layer. No I/O, no server-only imports:
// keys are derivable in tests and from the client-visible URL shape.

import type { StorageBucket } from "./types";

declare const derivedKey: unique symbol;

/**
 * A key the vocabulary derives: one object in a bucket.
 *
 * Branded, so a plain `string` is not one. The port takes this type and nothing else, which is the
 * compile-time half of the rule `ownerOfObjectKey` holds at runtime: a key is either produced by a
 * builder below or read back through `parseObjectKey`, and a string assembled anywhere else cannot
 * reach a bucket without a cast saying so. Both halves ask the same rule, so they cannot disagree
 * about what a key is — the type refuses it earlier and more cheaply, and the runtime check is what
 * remains for a value that arrived as data (a row, a listing, a request) or bypassed the type.
 */
export type ObjectKey = string & { readonly [derivedKey]: "object key" };

/**
 * A key set the vocabulary derives: what a listing or a prefix delete works on.
 *
 * Branded for the same reason as `ObjectKey`, against the prefix rule (`isObjectKeyPrefix`). The two
 * brands are distinct, so a set cannot be handed to a method that wants one object — except where
 * both are true of the same value, which is a staged archive: one object whose key *is* its whole
 * set (`epubUploadKey` returns both).
 */
export type KeySetPrefix = string & { readonly [derivedKey]: "key set" };

/**
 * The one place a plain string becomes a derived value.
 *
 * Private on purpose. A brand is minted here only for a shape this module assembled itself, or for a
 * value the predicates below have just read back, so every value of either branded type has been
 * built or checked by the vocabulary — which is what makes the type worth having rather than a
 * comment. Nothing outside this module can produce one without an explicit cast.
 */
function derived<T extends ObjectKey | KeySetPrefix>(value: string): T {
  return value as T;
}

/** The whole bucket: the one set that reaches every key in it, and the one spelling of "no prefix". */
export const WHOLE_BUCKET: KeySetPrefix = derived<KeySetPrefix>("");

/** Cover variants generated at upload time and served from the public bucket. */
export const COVER_WIDTHS = [320, 480, 640] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];

/** Object holding the untouched upload, kept so new widths can be derived later. */
export const COVER_ORIGINAL_NAME = "original";
export const COVER_VARIANT_CONTENT_TYPE = "image/webp";
/** Public bucket prefix. Must stay in sync with the bucket lifecycle rules. */
export const COVER_KEY_ROOT: KeySetPrefix = derived<KeySetPrefix>("covers");

/**
 * Profile-photo variants, generated at upload time. Square, because the shell
 * renders the photo in a circle and a portrait crop would distort a face.
 */
export const AVATAR_WIDTHS = [64, 128, 256] as const;
export type AvatarWidth = (typeof AVATAR_WIDTHS)[number];
export const AVATAR_VARIANT_CONTENT_TYPE = "image/webp";
/** Avatars share the public bucket with covers: guests will see them too. */
export const AVATAR_KEY_ROOT: KeySetPrefix = derived<KeySetPrefix>("avatars");

/**
 * One object under a set: the set's name plus one file name.
 *
 * Private, and one of the two joins the layout is made of: a caller holding a set builds either the
 * file names the layout prescribes (through `coverObjectKey`, `avatarVariantKey` and the rest) or a
 * set under another set (through `setUnder`), never a path of its own.
 */
function objectKey(prefix: KeySetPrefix, name: string): ObjectKey {
  return derived<ObjectKey>(`${prefix}/${name}`);
}

/**
 * A set one level under another: a novel's covers, then one uploaded segment's variants.
 *
 * Private for the same reason as `objectKey`: the depths that exist are the ones the builders below
 * spell, and `isObjectKeyPrefix` accepts exactly those.
 */
function setUnder(parent: KeySetPrefix, segment: string): KeySetPrefix {
  return derived<KeySetPrefix>(`${parent}/${segment}`);
}

/**
 * The same set, written without a trailing separator. Private: it normalises rather than checks, so a
 * value that has not been read back yet must not become a branded one through it.
 */
function withoutSeparator(prefix: string): string {
  return prefix.endsWith("/") ? prefix.replace(/\/+$/, "") : prefix;
}

/**
 * The key set a derived prefix names, written without a trailing separator. `""` is the whole
 * bucket, which stays the one spelling for "no prefix at all".
 */
export function keySetName(prefix: KeySetPrefix): KeySetPrefix {
  return derived<KeySetPrefix>(withoutSeparator(prefix));
}

/**
 * One key set, resolved: the name a set is addressed by and the boundary a store that
 * matches raw string prefixes must list or delete with.
 *
 * This is the single reading of a prefix. The port resolves it before it calls an adapter,
 * so no adapter interprets a prefix and none can read one differently from another — an
 * adapter chooses the field its backend needs, a directory named `name` or a listing scoped
 * to `boundary`. That is also what stops a set from reaching past its own keys: `avatars`
 * cannot match `avatars-archive/...`, and one novel's prefix cannot reach a longer id that
 * merely starts with it.
 *
 * `""` is the whole bucket, in both fields. A prefix the vocabulary does not derive is
 * refused before this is reached (`isObjectKeyPrefix`), so this never guesses.
 */
export interface KeySetScope {
  /** The set's name, with no separator: what a row stores and a directory is named. */
  name: KeySetPrefix;
  /**
   * The same set plus one separator, for a store that matches a raw string prefix. A plain string,
   * not a derived value: this is the spelling a transport needs, not a set the vocabulary names.
   */
  boundary: string;
}

export function keySetScope(prefix: KeySetPrefix): KeySetScope {
  const name = keySetName(prefix);
  return { name, boundary: name === "" ? "" : `${name}/` };
}

export const EPUB_UPLOAD_KEY_ROOT: KeySetPrefix = derived<KeySetPrefix>("epub-uploads");
export const EXPORT_KEY_ROOT: KeySetPrefix = derived<KeySetPrefix>("exports");
/** The two formats an export key can name; `exportObjectKey` appends one of these. */
export const EXPORT_FORMATS = ["txt", "epub"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** Bumping this invalidates every cached export. */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * `covers/<novelId>/<segment>` carries an unguessable segment so a replaced cover
 * gets a fresh URL: no purge, no cache-busting query, no stale CDN bytes.
 */
export function coverPrefix(novelId: string, segment: string): KeySetPrefix {
  return setUnder(setUnder(COVER_KEY_ROOT, novelId), segment);
}

/**
 * Every cover of one novel, regardless of the segment it was uploaded under, for the
 * listing and prefix delete that reconcile a deleted novel's bytes.
 */
export function coverOwnerPrefix(novelId: string): KeySetPrefix {
  return setUnder(COVER_KEY_ROOT, novelId);
}

export function coverObjectKey(prefix: KeySetPrefix, name: string): ObjectKey {
  return objectKey(prefix, name);
}

export function coverVariantKey(prefix: KeySetPrefix, width: CoverWidth): ObjectKey {
  return coverObjectKey(prefix, `${width}.webp`);
}

/** The widest variant, served when a caller does not ask for a specific width. */
export function defaultCoverWidth(): CoverWidth {
  return COVER_WIDTHS[COVER_WIDTHS.length - 1];
}

export function coverOriginalKey(prefix: KeySetPrefix): ObjectKey {
  return coverObjectKey(prefix, COVER_ORIGINAL_NAME);
}

export function avatarPrefix(userId: string, segment: string): KeySetPrefix {
  return setUnder(setUnder(AVATAR_KEY_ROOT, userId), segment);
}

/**
 * Parses `covers/<novelId>/<segment>` back into its parts, or null when the stored value has any
 * other shape.
 *
 * The counterpart of `parseAvatarPrefix` for the other prefix a row stores: a novel's cover set is
 * read back from the value the row holds rather than trusted, so a malformed one can neither name
 * another novel's objects nor become a key the port would take.
 */
export function parseCoverPrefix(prefix: string): { novelId: string; segment: string } | null {
  const parts = prefix.split("/");
  if (parts.length !== 3) return null;
  const [root, novelId, segment] = parts;
  if (root !== COVER_KEY_ROOT || !novelId || !segment) return null;
  return { novelId, segment };
}

/**
 * Parses `avatars/<userId>/<segment>` back into its parts, or null when the stored
 * value has any other shape. Callers use it to address an avatar without a second
 * column, and to reject a request whose URL does not match the stored prefix.
 */
export function parseAvatarPrefix(prefix: string): { userId: string; segment: string } | null {
  const parts = prefix.split("/");
  if (parts.length !== 3) return null;
  const [root, userId, segment] = parts;
  if (root !== AVATAR_KEY_ROOT || !userId || !segment) return null;
  return { userId, segment };
}

/**
 * The prefix an avatar object key belongs to (`avatars/<userId>/<segment>/<file>`),
 * or null when the key has any other shape. Reconciling stored objects against the
 * rows that point at them needs the grouping without re-deriving the layout.
 */
export function avatarObjectKeyPrefix(key: string): KeySetPrefix | null {
  const parts = key.split("/");
  if (parts.length < 4) return null;
  const prefix = parts.slice(0, 3).join("/");
  return parseAvatarPrefix(prefix) ? derived<KeySetPrefix>(prefix) : null;
}

export function avatarVariantKey(prefix: KeySetPrefix, width: AvatarWidth): ObjectKey {
  return objectKey(prefix, `${width}.webp`);
}

export function avatarOriginalKey(prefix: KeySetPrefix): ObjectKey {
  return objectKey(prefix, COVER_ORIGINAL_NAME);
}

/** The widest variant, served when a caller does not ask for a specific width. */
export function defaultAvatarWidth(): AvatarWidth {
  return AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1];
}

/**
 * Route that serves an avatar when no public CDN origin is configured (the
 * filesystem adapter used in local dev and CI). The path carries the unguessable
 * segment, so a replaced photo is a new URL and every response can be immutable.
 */
export function avatarProxyPath(userId: string, segment: string, width: AvatarWidth): string {
  return `/api/avatars/${userId}/${segment}?w=${width}`;
}

/**
 * A staged archive: one object, whose key is also the whole set it lives in.
 *
 * Both brands, because both are true of it — a caller reads it as a key (to verify or to delete an
 * abandoned upload) and as a set (to report it, or to group what nothing owns).
 */
export function epubUploadKey(uploadId: string): ObjectKey & KeySetPrefix {
  return derived<ObjectKey & KeySetPrefix>(`${EPUB_UPLOAD_KEY_ROOT}/${uploadId}`);
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

export function exportObjectKey(
  novelId: string,
  revision: string,
  format: ExportFormat,
): ObjectKey {
  return objectKey(exportKeyPrefix(novelId), `${revision}.${format}`);
}

/**
 * Every cached export of one novel. Spelled as the set name, like `coverOwnerPrefix`:
 * the adapters turn it into the boundary a listing or a delete needs.
 */
export function exportKeyPrefix(novelId: string): KeySetPrefix {
  return setUnder(EXPORT_KEY_ROOT, novelId);
}

/** What one stored object belongs to, as far as the layout says. */
export type StorageObjectOwner =
  | { kind: "cover"; novelId: string; segment: string }
  | { kind: "avatar"; userId: string; segment: string }
  | { kind: "export"; novelId: string }
  | { kind: "epub-upload"; uploadId: string };

export type StorageObjectKind = StorageObjectOwner["kind"];

/**
 * The owner a stored object key names, or null when no rule reads its shape.
 *
 * The reverse of every builder above, and the only ownership rule in the tree: the
 * reconciliation that prunes a deleted novel's bytes and the read-only audit that
 * reports what nothing owns both work from this, so the audit cannot disagree with
 * the sweep about what a key means. A key it cannot read is *unowned rather than
 * deletable*: null means the shape was never written by this app, so nothing may
 * attribute it to an owner or remove it.
 *
 * Built strictly from the shapes the builders produce — a cover needs its segment and
 * file, an export and an upload id are a whole set in themselves — so a key that is
 * only close to a real one (`covers/<novelId>` alone, a deeper upload path) reads as
 * unowned instead of being attributed to whatever its first segment suggests.
 */
export function ownerOfObjectKey(key: string): StorageObjectOwner | null {
  const parts = key.split("/");

  switch (parts[0]) {
    case COVER_KEY_ROOT: {
      const [, novelId, segment, file] = parts;
      if (parts.length !== 4 || !novelId || !segment || !file) return null;
      return { kind: "cover", novelId, segment };
    }
    case AVATAR_KEY_ROOT: {
      const prefix = avatarObjectKeyPrefix(key);
      const parsed = prefix === null ? null : parseAvatarPrefix(prefix);
      if (!parsed) return null;
      return { kind: "avatar", userId: parsed.userId, segment: parsed.segment };
    }
    case EXPORT_KEY_ROOT: {
      const [, novelId, file] = parts;
      if (parts.length !== 3 || !novelId || !file) return null;
      // The format is part of the key the vocabulary derives, so a name without one is a
      // shape nothing here wrote rather than an export to attribute and later delete.
      if (!EXPORT_FORMATS.some((format) => file.endsWith(`.${format}`))) return null;
      return { kind: "export", novelId };
    }
    case EPUB_UPLOAD_KEY_ROOT: {
      const [, uploadId] = parts;
      if (parts.length !== 2 || !uploadId) return null;
      return { kind: "epub-upload", uploadId };
    }
    default:
      return null;
  }
}

/** Every key root the vocabulary writes under. */
const KEY_ROOTS: readonly string[] = [
  COVER_KEY_ROOT,
  AVATAR_KEY_ROOT,
  EPUB_UPLOAD_KEY_ROOT,
  EXPORT_KEY_ROOT,
];

/**
 * Whether a prefix names a set the vocabulary derives, for a listing or a prefix delete.
 *
 * The prefix half of `ownerOfObjectKey`: the whole bucket (`""`), a key root, an owner's
 * whole set (`covers/<novelId>` is every segment a novel ever uploaded, `exports/<novelId>`
 * its export cache), or one set (`covers/<novelId>/<segment>`, `avatars/<userId>/<segment>`,
 * `epub-uploads/<uploadId>`). A trailing separator names the same set.
 *
 * No other depth is derived, so a prefix at one is refused rather than read charitably:
 * `avatars/<userId>` names no set (a photo set is per user *and* segment), and behind a set
 * (`covers/<novelId>/<segment>/<file>`) a prefix would mean one object, not a set.
 */
export function isObjectKeyPrefix(prefix: string): prefix is KeySetPrefix {
  const name = withoutSeparator(prefix);
  if (name === "") return true;

  const parts = name.split("/");
  const [root] = parts;
  if (parts.length === 1) return KEY_ROOTS.includes(root);
  const atDepth = (depth: number) => parts.length === depth && parts.every((part) => part !== "");

  switch (root) {
    case COVER_KEY_ROOT:
      // A novel's whole cover set, or one of the segments it uploaded.
      return atDepth(2) || atDepth(3);
    case AVATAR_KEY_ROOT:
      return atDepth(3);
    case EXPORT_KEY_ROOT:
    case EPUB_UPLOAD_KEY_ROOT:
      return atDepth(2);
    default:
      return false;
  }
}

/**
 * A stored value read back as the key it is, with the object that owns it.
 *
 * The one door from a string this module did not build — a row's `object_key`, a bucket listing, a
 * request parameter — into the type the port takes. Null means the value is not a shape the
 * vocabulary writes, which is what `ownerOfObjectKey` answers and what the port's runtime guard
 * refuses; both ask that one rule, so a value admitted here is one the port admits too.
 */
export interface StoredObjectKey {
  key: ObjectKey;
  owner: StorageObjectOwner;
}

export function parseObjectKey(value: string): StoredObjectKey | null {
  const owner = ownerOfObjectKey(value);
  return owner === null ? null : { key: derived<ObjectKey>(value), owner };
}

/**
 * The bucket a kind lives in. Public objects are served to guests from the CDN origin,
 * so a kind found in the other bucket is a misplaced object rather than a courtesy.
 *
 * A record rather than a condition, because a new kind that does not say which bucket it
 * belongs in should fail to compile instead of defaulting to one.
 */
const BUCKET_OF_KIND: Record<StorageObjectKind, StorageBucket> = {
  cover: "public",
  avatar: "public",
  export: "private",
  "epub-upload": "private",
};

export function ownerBucket(kind: StorageObjectKind): StorageBucket {
  return BUCKET_OF_KIND[kind];
}

/**
 * The set an owner's objects live in, spelled the way a listing or a prefix delete takes it.
 *
 * The narrowest set that owner has — one segment's cover variants, one photo set, one novel's
 * export cache, one staged archive — and every one of them is a prefix `isObjectKeyPrefix`
 * accepts, so a caller can hand it straight to `listKeys`/`deletePrefix` and reach exactly
 * those objects and no sibling that merely shares their characters.
 *
 * `ownerOfObjectKey` reads a key back to its owner; this names that owner's set. The audit and
 * the test-run footprint both go through here rather than each deciding for itself which set a
 * key belongs to, so an object attributed to an owner and an object removed with that owner
 * cannot disagree about where it lives.
 */
export function setOfOwner(owner: StorageObjectOwner): KeySetPrefix {
  switch (owner.kind) {
    case "cover":
      return coverPrefix(owner.novelId, owner.segment);
    case "avatar":
      return avatarPrefix(owner.userId, owner.segment);
    case "export":
      return exportKeyPrefix(owner.novelId);
    case "epub-upload":
      return epubUploadKey(owner.uploadId);
  }
}
