import "@tanstack/react-start/server-only";

import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { getPrivateStorage, getPublicStorage } from "@/lib/storage/index.server";
import { COVER_KEY_ROOT, EXPORT_KEY_ROOT, parseAvatarPrefix } from "@/lib/storage/keys";

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
 */

/** Bounds the ownership lookup so a large bucket cannot become one huge `IN` clause. */
const OWNER_LOOKUP_CHUNK = 200;

export interface OrphanAssetPlan {
  /** Owner ids present in the listing with no surviving row. */
  orphanOwnerIds: string[];
  /** Keys whose shape is not `<root>/<ownerId>/...`; never touched. */
  unrecognized: number;
}

/**
 * Groups object keys by the id that owns them, keeping only owners that no longer
 * exist. Anything that is not exactly `<root>/<ownerId>/...` is counted and left
 * alone, so a key that merely sits under the same prefix can never be deleted.
 */
export function selectOrphanAssetOwners(
  keys: readonly string[],
  root: string,
  knownOwnerIds: ReadonlySet<string>,
): OrphanAssetPlan {
  const orphans = new Set<string>();
  let unrecognized = 0;

  for (const key of keys) {
    const parts = key.split("/");
    const ownerId = parts[0] === root ? parts[1] : undefined;
    if (parts.length < 3 || !ownerId) {
      unrecognized += 1;
      continue;
    }
    if (!knownOwnerIds.has(ownerId)) orphans.add(ownerId);
  }

  return { orphanOwnerIds: [...orphans].toSorted(), unrecognized };
}

/** Owner ids that appear in a listing, in listing order without duplicates. */
function listedOwnerIds(keys: readonly string[], root: string): string[] {
  const ids = new Set<string>();
  for (const key of keys) {
    const parts = key.split("/");
    if (parts.length >= 3 && parts[0] === root && parts[1]) ids.add(parts[1]);
  }
  return [...ids];
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

  const coverOwnerIds = listedOwnerIds(coverKeys, COVER_KEY_ROOT);
  const exportOwnerIds = listedOwnerIds(exportKeys, EXPORT_KEY_ROOT);
  const candidates = [...new Set([...coverOwnerIds, ...exportOwnerIds])];
  const existing = await filterExistingNovelIds(candidates);

  const orphanCovers = selectOrphanAssetOwners(coverKeys, COVER_KEY_ROOT, existing).orphanOwnerIds;
  const orphanExports = selectOrphanAssetOwners(
    exportKeys,
    EXPORT_KEY_ROOT,
    existing,
  ).orphanOwnerIds;

  const result: NovelAssetPruneResult = {
    coveredOwners: coverOwnerIds.length,
    orphanCoverOwners: orphanCovers.length,
    orphanExportOwners: orphanExports.length,
    deleted: [],
    failures: [],
  };

  for (const novelId of orphanCovers) {
    const prefix = `${COVER_KEY_ROOT}/${novelId}/`;
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
    const prefix = `${EXPORT_KEY_ROOT}/${novelId}/`;
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
    await getPublicStorage().deletePrefix(`${image}/`);
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
