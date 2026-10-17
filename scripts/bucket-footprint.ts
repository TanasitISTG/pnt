import { log } from "@/lib/log";
import {
  ownerOfObjectKey,
  parseObjectKey,
  setOfOwner,
  WHOLE_BUCKET,
  type ObjectKey,
  type StorageObjectKind,
} from "@/lib/storage/keys";
import type { ObjectStorage, StorageBucket } from "@/lib/storage/types";

/**
 * The objects a test run added to the shared buckets, so the run can remove them.
 *
 * The application and both test runs write to the same two buckets, and the sweeps that empty
 * them work from rows: the scheduled purge removes a deleted novel's bytes, `storage:prune-avatars`
 * removes a photo set no row stores, and a staged archive whose row is gone is reaped by nobody
 * at all. A test run migrates a database of its own and drops it, so every set it creates is
 * exactly that kind of leftover — the row that would have owned it dies with the run, and a
 * staged archive fails verification by design in the suites that assert the failure. So the run
 * measures both buckets before it starts and removes the sets it created when it ends, through
 * the same port the application writes with.
 *
 * A set counts as the run's only when *every* key in it is new. A set that already held an
 * object is one the run did not create — a novel that was already in the bucket, an export
 * cache a previous run filled — and removing it would take objects this run never wrote, so
 * those keys are reported and left alone instead. A key whose shape no rule reads is reported
 * for the same reason, exactly as the audit reports it.
 *
 * Objects are removed by key, never by prefix: a staged archive is a single object whose key *is*
 * its set, so a prefix delete of it reaches the file on the filesystem adapter and finds nothing
 * in a bucket, while the key delete is what the application itself uses for an abandoned upload
 * and means the same thing on every adapter.
 *
 * The window this measures is the run's own: for that window nothing else may be writing to
 * those buckets, which the supervisors arrange by taking the footprint immediately before they
 * start the run and removing it after everything they started has stopped. It is the same
 * assumption an audit makes when it reads ownership from one database (`storage:audit`).
 *
 * Listing is the whole bucket rather than the roots the sweeps scan, because a run writes
 * everywhere and a root-scoped footprint would silently miss what it left outside them. An
 * unlistable bucket is not an empty one: nothing is removed from a bucket that could not be
 * read, and the run reports it rather than claiming a clean sweep.
 */

/** One set the run created, with the keys that prove it. */
export interface AddedSet {
  /** The set, spelled the way the vocabulary names it (`setOfOwner`) and the audit reports it. */
  set: string;
  kind: StorageObjectKind;
  /** The keys the run added to it, so a report names objects and not only a total. */
  keys: ObjectKey[];
}

export interface FootprintChanges {
  /** Sets whose every key is new, so the run created them and may remove them. */
  addedSets: AddedSet[];
  /** New keys that landed in a set which already existed: reported, never removed. */
  addedToExistingSets: string[];
  /** New keys whose shape no rule reads: reported, never removed. */
  unrecognizedKeys: string[];
}

/**
 * Classifies what a run added to one bucket. Pure: two listings in, what to remove out, so the
 * rule a sweep follows is the rule its test reads.
 */
export function changesBetween(
  before: readonly string[],
  after: readonly string[],
): FootprintChanges {
  const heldBefore = new Set(before);
  const setsBefore = new Set<string>();
  for (const key of before) {
    const owner = ownerOfObjectKey(key);
    if (owner) setsBefore.add(setOfOwner(owner));
  }

  const added = new Map<string, AddedSet>();
  const addedToExistingSets: string[] = [];
  const unrecognizedKeys: string[] = [];

  for (const value of [...after].toSorted()) {
    if (heldBefore.has(value)) continue;

    // Read back rather than trusted: a listing is a bucket's own report of what it holds, including
    // shapes from an older layout, and only a value the vocabulary derives names an owner to remove
    // it with.
    const stored = parseObjectKey(value);
    if (stored === null) {
      unrecognizedKeys.push(value);
      continue;
    }
    const set = setOfOwner(stored.owner);
    if (setsBefore.has(set)) {
      addedToExistingSets.push(value);
      continue;
    }

    const entry = added.get(set) ?? { set, kind: stored.owner.kind, keys: [] };
    entry.keys.push(stored.key);
    added.set(set, entry);
  }

  return {
    addedSets: [...added.values()].toSorted((left, right) => left.set.localeCompare(right.set)),
    addedToExistingSets,
    unrecognizedKeys,
  };
}

/** One bucket, listed before the run. `null` keys mean it could not be listed at all. */
interface BucketListing {
  bucket: StorageBucket;
  keys: readonly string[] | null;
}

/** Both buckets as they stood when the run started. */
export interface BucketFootprint {
  readonly listings: readonly BucketListing[];
}

export interface FootprintCleanup {
  bucket: StorageBucket;
  /** The sets the run created whose every object this removed. */
  removedSets: string[];
  /** How many objects went with them, so a report counts objects and not only sets. */
  removedKeys: number;
  /** An object that could not be removed, which is what an operator has to finish by hand. */
  failures: { key: ObjectKey; message: string }[];
  /** New keys left in place deliberately, with the reason each was left. */
  addedToExistingSets: string[];
  unrecognizedKeys: string[];
  /** True when the bucket could not be listed, so nothing was removed from it. */
  listed: boolean;
}

/**
 * The environment the run's own processes were started with.
 *
 * `@/lib/env` validates when it first loads and the storage selection reads it once, so this has
 * to be in place before the port is imported. A supervisor's own environment is not always the
 * run's — the E2E supervisor composes one, pinning `NODE_ENV=development` precisely because a
 * production `NODE_ENV` on the host would select a schema this run leaves unsatisfied — so the
 * cleanup has to read the bucket that environment names. Applied verbatim: the environment that
 * brought the application up is the one that reaches the same buckets, and it is known to satisfy
 * the schema.
 */
function applyRunEnvironment(environment: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** Lists one bucket, resolving the port only once the run's environment is in place. */
async function listBucket(bucket: StorageBucket, storage: ObjectStorage): Promise<BucketListing> {
  const keys = await storage.listKeys(WHOLE_BUCKET);
  if (keys === null) {
    log("warn", "run footprint: bucket could not be listed, so nothing will be removed from it", {
      bucket,
    });
  }
  return { bucket, keys };
}

/**
 * Lists both buckets, so the run that follows can be asked to remove what it added.
 *
 * Take it immediately before starting the run and remove with the same environment afterwards:
 * the footprint is the window, and anything else writing inside that window is read as the run's.
 */
export async function openBucketFootprint(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<BucketFootprint> {
  applyRunEnvironment(environment);
  const { getPrivateStorage, getPublicStorage } = await import("@/lib/storage/index.server");

  return {
    listings: [
      await listBucket("public", getPublicStorage()),
      await listBucket("private", getPrivateStorage()),
    ],
  };
}

/**
 * Removes the sets the run created, and reports what it left.
 *
 * One object at a time, by the key the listing named. A container set goes that way because every key
 * in it is new — that is what makes the set the run's — so removing them all removes the set, and a
 * set is reported as removed only once every one of its objects is.
 *
 * A failure is collected rather than thrown: the run's own result is not this sweep's to report, and
 * a caller that aborted here would lose the tests' outcome to a cleanup problem. Nothing is removed
 * from a bucket that could not be listed, and nothing is removed that was not the run's.
 */
export async function removeAddedObjects(
  footprint: BucketFootprint,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<FootprintCleanup[]> {
  applyRunEnvironment(environment);
  const { getPrivateStorage, getPublicStorage } = await import("@/lib/storage/index.server");
  const storage = { public: getPublicStorage(), private: getPrivateStorage() };

  const cleanups: FootprintCleanup[] = [];
  for (const listing of footprint.listings) {
    const cleanup: FootprintCleanup = {
      bucket: listing.bucket,
      removedSets: [],
      removedKeys: 0,
      failures: [],
      addedToExistingSets: [],
      unrecognizedKeys: [],
      listed: listing.keys !== null,
    };
    cleanups.push(cleanup);
    if (listing.keys === null) continue;

    const keys = await storage[listing.bucket].listKeys(WHOLE_BUCKET);
    if (keys === null) {
      cleanup.listed = false;
      log("warn", "run footprint: bucket could not be listed, so nothing was removed from it", {
        bucket: listing.bucket,
      });
      continue;
    }

    const changes = changesBetween(listing.keys, keys);
    cleanup.addedToExistingSets = changes.addedToExistingSets;
    cleanup.unrecognizedKeys = changes.unrecognizedKeys;

    for (const { set, keys: addedKeys } of changes.addedSets) {
      let removed = 0;
      for (const key of addedKeys) {
        try {
          await storage[listing.bucket].delete(key);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          cleanup.failures.push({ key, message });
          // Logged where it happened, because this is the one outcome an operator has to finish:
          // the run's exit code stays the tests' to report, so this line is the only signal that
          // the buckets still hold something the run created.
          log("error", "run footprint: an object this run created could not be removed", {
            bucket: listing.bucket,
            set,
            key,
            error: message,
          });
          continue;
        }
        removed += 1;
      }

      cleanup.removedKeys += removed;
      if (removed === addedKeys.length) cleanup.removedSets.push(set);
      log("info", "run footprint: removed the objects of a set this run created", {
        bucket: listing.bucket,
        set,
        objects: removed,
      });
    }
  }

  return cleanups;
}

/** The one line a supervisor prints when the run left something, or null when it left nothing. */
export function describeFootprintCleanup(cleanups: readonly FootprintCleanup[]): string | null {
  const removed = cleanups.reduce((total, cleanup) => total + cleanup.removedKeys, 0);
  const failures = cleanups.flatMap((cleanup) => cleanup.failures);
  const unlisted = cleanups.filter((cleanup) => !cleanup.listed).map((cleanup) => cleanup.bucket);
  if (removed === 0 && failures.length === 0 && unlisted.length === 0) return null;

  const sets = cleanups.reduce((total, cleanup) => total + cleanup.removedSets.length, 0);
  const parts = [`removed ${removed} object(s) in ${sets} set(s) this run created`];
  if (failures.length > 0) parts.push(`${failures.length} object(s) could not be removed`);
  if (unlisted.length > 0) parts.push(`${unlisted.join(" and ")} bucket(s) could not be listed`);
  return parts.join(", ");
}
