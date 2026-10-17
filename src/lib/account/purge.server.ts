import "@tanstack/react-start/server-only";

import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { epubUploads, novels } from "@/lib/db/schema";
import { currentExportCacheKeys } from "@/lib/export/stream";
import { log } from "@/lib/log";
import { getPrivateStorage, getPublicStorage } from "@/lib/storage/index.server";
import {
  avatarPrefix,
  COVER_KEY_ROOT,
  coverOwnerPrefix,
  EPUB_UPLOAD_KEY_ROOT,
  EXPORT_KEY_ROOT,
  exportKeyPrefix,
  ownerOfObjectKey,
  parseAvatarPrefix,
  parseObjectKey,
  setOfOwner,
  type KeySetPrefix,
  type ObjectKey,
  type StorageObjectKind,
} from "@/lib/storage/keys";
import type { StorageObjectEntry } from "@/lib/storage/types";

/**
 * Reconciles object storage against the rows that own it.
 *
 * Deleting an account cascades its novels away in Postgres, but the objects those
 * novels wrote — cover variants in the public bucket and cached exports in the
 * private one — are not touched by any foreign key, so they would be stranded
 * forever. The reconciliation is keyed off the object listing rather than off a
 * record kept at deletion time, which means it also self-heals orphans left by any
 * earlier failure and stays correct when a delete hook never fires.
 *
 * Only covers and exports are pruned automatically. Both are written strictly after
 * their owning novel row exists, so an ownerless group is unambiguously abandoned.
 * Avatar sets are written *before* their user row, so an automated sweep could
 * mistake a fresh upload for an orphan; those stay with the idle-time
 * `storage:prune-avatars` script, while account deletion removes that account's own
 * set precisely (see `deleteAvatarSet`).
 *
 * Two rules live here, and they answer different questions about the same buckets. A
 * deleted novel leaves an ownerless set, which is `pruneOrphanNovelAssets`'s. A
 * *surviving* owner leaves sets it no longer names — the cover segment a replacement
 * superseded, the cached export revision the content moved past, the staged archive a
 * cleaned-up upload row left behind — which no row can ever name again and which
 * `reapSupersededAssets` removes. Both run in the same daily sweep, so the audit can
 * name one thing that removes each kind of residue.
 */

/** Bounds the ownership lookup so a large bucket cannot become one huge `IN` clause. */
const OWNER_LOOKUP_CHUNK = 200;

/**
 * The novel ids a listing addresses, read through the one ownership rule.
 *
 * A key the rule cannot read names no owner and is left alone, so a key that merely
 * shares a prefix with a real one can never be attributed to a novel and deleted with
 * it. The read-only audit reports those keys rather than acting on them.
 */
function novelIdsInListing(keys: readonly string[], kind: "cover" | "export"): string[] {
  const ids = new Set<string>();
  for (const key of keys) {
    const owner = ownerOfObjectKey(key);
    if (owner?.kind === kind) ids.add(owner.novelId);
  }
  return [...ids];
}

/** The ids in a listing whose rows are gone, in listing order without duplicates. */
export function selectOrphanAssetOwners(
  keys: readonly string[],
  kind: Extract<StorageObjectKind, "cover" | "export">,
  knownOwnerIds: ReadonlySet<string>,
): { orphanOwnerIds: string[]; unrecognized: number } {
  const orphans = new Set<string>();
  let unrecognized = 0;

  for (const key of keys) {
    const owner = ownerOfObjectKey(key);
    if (owner?.kind !== kind) {
      unrecognized += 1;
      continue;
    }
    if (!knownOwnerIds.has(owner.novelId)) orphans.add(owner.novelId);
  }

  return { orphanOwnerIds: [...orphans].toSorted(), unrecognized };
}

async function filterExistingNovelIds(candidateIds: readonly string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let index = 0; index < candidateIds.length; index += OWNER_LOOKUP_CHUNK) {
    const chunk = candidateIds.slice(index, index + OWNER_LOOKUP_CHUNK);
    const rows = await db.select({ id: novels.id }).from(novels).where(inArray(novels.id, chunk));
    for (const row of rows) existing.add(row.id);
  }
  return existing;
}

export interface NovelAssetPruneResult {
  coveredOwners: number;
  orphanCoverOwners: number;
  orphanExportOwners: number;
  deleted: string[];
  failures: Array<{ prefix: string; message: string }>;
}

/**
 * Removes cover and export objects for novels that no longer exist.
 *
 * A listing that fails aborts the run instead of being read as an empty bucket: a
 * sweep that treated an unreachable bucket as "nothing to do" would report a clean
 * pass having inspected nothing.
 */
export async function pruneOrphanNovelAssets(): Promise<NovelAssetPruneResult> {
  const publicStorage = getPublicStorage();
  const privateStorage = getPrivateStorage();

  const coverKeys = await publicStorage.listKeys(COVER_KEY_ROOT);
  if (coverKeys === null) {
    throw new Error("The public bucket could not be listed; nothing was deleted.");
  }
  const exportKeys = await privateStorage.listKeys(EXPORT_KEY_ROOT);
  if (exportKeys === null) {
    throw new Error("The private bucket could not be listed; nothing was deleted.");
  }

  const coverOwnerIds = novelIdsInListing(coverKeys, "cover");
  const exportOwnerIds = novelIdsInListing(exportKeys, "export");
  const candidates = [...new Set([...coverOwnerIds, ...exportOwnerIds])];
  const existing = await filterExistingNovelIds(candidates);

  const orphanCovers = selectOrphanAssetOwners(coverKeys, "cover", existing).orphanOwnerIds;
  const orphanExports = selectOrphanAssetOwners(exportKeys, "export", existing).orphanOwnerIds;

  const result: NovelAssetPruneResult = {
    coveredOwners: coverOwnerIds.length,
    orphanCoverOwners: orphanCovers.length,
    orphanExportOwners: orphanExports.length,
    deleted: [],
    failures: [],
  };

  for (const novelId of orphanCovers) {
    const prefix = coverOwnerPrefix(novelId);
    try {
      await publicStorage.deletePrefix(prefix);
      result.deleted.push(prefix);
    } catch (error: unknown) {
      result.failures.push({
        prefix,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const novelId of orphanExports) {
    const prefix = exportKeyPrefix(novelId);
    try {
      await privateStorage.deletePrefix(prefix);
      result.deleted.push(prefix);
    } catch (error: unknown) {
      result.failures.push({
        prefix,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (result.deleted.length > 0 || result.failures.length > 0) {
    log("info", "pruned orphan novel assets", {
      deleted: result.deleted.length,
      failures: result.failures.length,
    });
  }

  return result;
}

/**
 * How old the newest object of a set must be before a sweep may call the set abandoned.
 *
 * Every writer here puts the objects *before* the row that names them: a cover is uploaded and then
 * the novel's `cover_key` names it, an export is spooled as the download that produced it finishes,
 * and a staged archive is written by the PUT a presigned URL authorised. So a rule that read "the
 * owner does not name this" as "this is abandoned" could delete a set a request is writing right
 * now — unattended, on a schedule, with no operator watching. What separates the two cases is age,
 * and a store always knows when it wrote an object.
 *
 * A day is four orders of magnitude more headroom than any of those windows: a cover replacement is
 * seconds of work, an export spool is one download under the cache cap, and a presigned upload's own
 * window is an hour at the very most. The cost is that a genuinely stale set waits for the next daily
 * run, which is the same trade the sweep itself makes.
 */
const SUPERSEDED_GRACE_MS = 24 * 60 * 60 * 1000;

/** What one superseded sweep reads: three listings, the rows that own them, and the current keys. */
export interface SupersededReapInput {
  /** Every object under the public bucket's cover root, as the bucket listed it. */
  coverObjects: readonly StorageObjectEntry[];
  /** Every object under the private bucket's export root. */
  exportObjects: readonly StorageObjectEntry[];
  /** Every object under the private bucket's staged-archive root. */
  uploadObjects: readonly StorageObjectEntry[];
  /**
   * The novels that still exist, each mapped to the cover set its row names — `null` when it names
   * none. A novel missing from this map is the orphan prune's business, not this sweep's.
   */
  liveNovels: ReadonlyMap<string, string | null>;
  /** The export cache keys the route would compute now, for the novels that can be exported. */
  currentExportKeys: ReadonlySet<string>;
  /** `epub_uploads.object_key`: the staged archives a row still names. */
  knownUploadKeys: ReadonlySet<string>;
  now: Date;
}

/** What one superseded sweep removes, and what it deliberately leaves. */
export interface SupersededPlan {
  /** Cover segments a surviving novel no longer names, oldest first: one prefix delete each. */
  coverSets: Array<{ set: KeySetPrefix; objects: string[] }>;
  /** Cached export revisions the content has moved past: one key delete each. */
  exportKeys: ObjectKey[];
  /** Staged archives no upload row names: one key delete each. */
  uploadKeys: ObjectKey[];
  /** Objects left in place because the store wrote them inside the grace period. */
  tooFresh: number;
}

/**
 * Decides which sets a surviving owner no longer names, whichever bucket they are in.
 *
 * Pure: listings, rows and the current revision keys in, what to remove out, so the rule a sweep
 * follows is the rule its test reads. Every decision is made from the one ownership rule
 * (`parseObjectKey`, `setOfOwner`) rather than from string prefixes, so a key that merely shares
 * characters with a real one is left alone — and a key whose shape no rule reads is the audit's to
 * report, never this sweep's to delete.
 *
 * A cover set is removed as a set and the other two by key: a staged archive is a single object whose
 * key *is* its set, so a prefix delete of it has nothing to sweep on a store that matches prefixes.
 *
 * The grace period is applied to the newest object of a set, which is what makes the whole set old
 * enough: any object of it being recent enough to be in flight is a reason to leave every one of them.
 */
export function planSupersededRemovals(input: SupersededReapInput): SupersededPlan {
  const cutoff = input.now.getTime() - SUPERSEDED_GRACE_MS;
  const isAbandoned = (object: StorageObjectEntry) => object.lastModified.getTime() <= cutoff;
  const plan: SupersededPlan = { coverSets: [], exportKeys: [], uploadKeys: [], tooFresh: 0 };

  const coverSets = new Map<KeySetPrefix, { novelId: string; objects: StorageObjectEntry[] }>();
  for (const object of input.coverObjects) {
    const stored = parseObjectKey(object.key);
    if (stored === null || stored.owner.kind !== "cover") continue;
    const set = setOfOwner(stored.owner);
    const group = coverSets.get(set) ?? { novelId: stored.owner.novelId, objects: [] };
    group.objects.push(object);
    coverSets.set(set, group);
  }

  for (const [set, group] of coverSets) {
    if (!input.liveNovels.has(group.novelId)) continue;
    // The one set the novel names is its live cover; every other segment is one a replacement wrote
    // and then failed to remove. A row that names nothing (a removed cover) names no segment at all.
    if (input.liveNovels.get(group.novelId) === set) continue;
    if (!group.objects.every(isAbandoned)) {
      plan.tooFresh += group.objects.length;
      continue;
    }
    plan.coverSets.push({
      set,
      objects: group.objects.map((object) => object.key).toSorted(),
    });
  }

  for (const object of input.exportObjects) {
    const stored = parseObjectKey(object.key);
    if (stored === null || stored.owner.kind !== "export") continue;
    if (!input.liveNovels.has(stored.owner.novelId)) continue;
    // The cache key is a content fingerprint, so the revision the content is on now is the only
    // reachable one: every other object under a live novel is a revision the export has moved past.
    if (input.currentExportKeys.has(object.key)) continue;
    if (!isAbandoned(object)) {
      plan.tooFresh += 1;
      continue;
    }
    plan.exportKeys.push(stored.key);
  }

  for (const object of input.uploadObjects) {
    const stored = parseObjectKey(object.key);
    if (stored === null || stored.owner.kind !== "epub-upload") continue;
    if (input.knownUploadKeys.has(object.key)) continue;
    if (!isAbandoned(object)) {
      plan.tooFresh += 1;
      continue;
    }
    plan.uploadKeys.push(stored.key);
  }

  return {
    coverSets: plan.coverSets.toSorted((left, right) => left.set.localeCompare(right.set)),
    exportKeys: plan.exportKeys.toSorted((left, right) => left.localeCompare(right)),
    uploadKeys: plan.uploadKeys.toSorted((left, right) => left.localeCompare(right)),
    tooFresh: plan.tooFresh,
  };
}

/** What one superseded sweep removed, and what it could not. */
export interface SupersededReapResult {
  /** Cover sets removed, spelled the way the delete addressed them. */
  deletedSets: string[];
  /** Objects removed one at a time: superseded export revisions and row-less staged archives. */
  deletedKeys: string[];
  /** Objects those removals took with them, so a report counts objects and not only targets. */
  deletedObjects: number;
  /** Objects left in place because the store wrote them inside the grace period. */
  tooFresh: number;
  /** Anything that could not be removed, which is what an operator has to finish by hand. */
  failures: Array<{ target: string; message: string }>;
}

/**
 * Removes the sets a surviving owner no longer names.
 *
 * The listings are read first and a bucket that could not be listed aborts the run rather than being
 * read as empty: a sweep that treated an unreachable bucket as "nothing to do" would report a clean
 * pass having inspected nothing. Each removal is collected rather than thrown, because one object an
 * operator has to finish by hand is not a reason to abandon the rest of the work.
 *
 * `now` is what the grace period is measured against, so a test can decide for itself which objects
 * are established and which are in flight.
 */
export async function reapSupersededAssets(now: Date = new Date()): Promise<SupersededReapResult> {
  const publicStorage = getPublicStorage();
  const privateStorage = getPrivateStorage();

  const [coverObjects, exportObjects, uploadObjects] = await Promise.all([
    publicStorage.listObjects(COVER_KEY_ROOT),
    privateStorage.listObjects(EXPORT_KEY_ROOT),
    privateStorage.listObjects(EPUB_UPLOAD_KEY_ROOT),
  ]);
  if (coverObjects === null) {
    throw new Error("The public bucket could not be listed; nothing was deleted.");
  }
  if (exportObjects === null || uploadObjects === null) {
    throw new Error("The private bucket could not be listed; nothing was deleted.");
  }

  const [novelRows, uploadRows] = await Promise.all([
    db.select({ id: novels.id, coverKey: novels.coverKey }).from(novels),
    db.select({ objectKey: epubUploads.objectKey }).from(epubUploads),
  ]);

  // Only the novels that actually hold a cached export are asked about, so the revision lookup is
  // bounded by the bucket rather than by the library.
  const exportNovelIds = new Set<string>();
  for (const object of exportObjects) {
    const stored = parseObjectKey(object.key);
    if (stored?.owner.kind === "export") exportNovelIds.add(stored.owner.novelId);
  }

  const plan = planSupersededRemovals({
    coverObjects,
    exportObjects,
    uploadObjects,
    liveNovels: new Map(novelRows.map((row) => [row.id, row.coverKey])),
    currentExportKeys: await currentExportCacheKeys([...exportNovelIds]),
    knownUploadKeys: new Set(uploadRows.map((row) => row.objectKey)),
    now,
  });

  const result: SupersededReapResult = {
    deletedSets: [],
    deletedKeys: [],
    deletedObjects: 0,
    tooFresh: plan.tooFresh,
    failures: [],
  };

  for (const { set, objects } of plan.coverSets) {
    try {
      await publicStorage.deletePrefix(set);
      result.deletedSets.push(set);
      result.deletedObjects += objects.length;
    } catch (error: unknown) {
      result.failures.push({
        target: set,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Both kinds live in the private bucket, and both are removed one object at a time: a staged
  // archive is a file rather than a directory on the filesystem adapter and a prefix with no
  // separator in the store, so a key delete is what means the same thing on every adapter.
  for (const key of [...plan.exportKeys, ...plan.uploadKeys]) {
    try {
      await privateStorage.delete(key);
      result.deletedKeys.push(key);
      result.deletedObjects += 1;
    } catch (error: unknown) {
      result.failures.push({
        target: key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    result.deletedSets.length > 0 ||
    result.deletedKeys.length > 0 ||
    result.failures.length > 0
  ) {
    log("info", "reaped superseded storage", {
      sets: result.deletedSets.length,
      keys: result.deletedKeys.length,
      objects: result.deletedObjects,
      tooFresh: result.tooFresh,
      failures: result.failures.length,
    });
  }

  return result;
}

/**
 * Removes one account's avatar set.
 *
 * Safe to call from the account-delete hook: the user row is already gone, so
 * nothing can re-reference this exact prefix, and the work is bounded to the three
 * objects of a single set. Returns false when the stored value is not an avatar
 * prefix, so a malformed `image` can never be used to reach another key.
 */
export async function deleteAvatarSet(image: string | null): Promise<boolean> {
  if (!image) return false;
  const parsed = parseAvatarPrefix(image);
  if (!parsed) return false;

  try {
    await getPublicStorage().deletePrefix(avatarPrefix(parsed.userId, parsed.segment));
    return true;
  } catch (error: unknown) {
    // Account deletion has already committed; a failed cleanup is operator work,
    // not a reason to report the deletion as failed.
    log("error", "avatar cleanup after account deletion failed", {
      userId: parsed.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
