import { config as loadEnv } from "dotenv";

import { log } from "@/lib/log";
import {
  ownerBucket,
  ownerOfObjectKey,
  parseAvatarPrefix,
  parseObjectKey,
  setOfOwner,
  WHOLE_BUCKET,
  type StorageObjectKind,
  type StorageObjectOwner,
} from "@/lib/storage/keys";
import type { StorageBucket } from "@/lib/storage/types";

/**
 * Reports who owns every object in the buckets, and what nothing owns.
 *
 * The sweeps are deliberate and narrow: the daily storage sweep prunes what a deleted row owned and
 * reaps what a surviving one stopped naming, `storage:prune-avatars` removes avatar sets no row
 * stores, and nothing else ever removes anything. So an object outside those rules stays in the
 * bucket forever, and the only way to find it is to read the whole bucket and ask the same ownership
 * rule the sweeps ask. This does exactly that and changes nothing: it lists, classifies and prints.
 *
 * It lists the *whole* bucket rather than the roots the sweeps scan, because a key
 * outside those roots is one of the things an operator needs to see.
 *
 * What it reports:
 * - A set no row names, with the sweep that removes it and why no row names it: the owning row is
 *   gone, or it survives and has moved on — a cover segment a replacement superseded, an export
 *   revision the content moved past.
 * - A set whose shape no rule reads. Null from the ownership rule means "unowned rather
 *   than deletable", so these are named and left alone.
 * - A key found in the wrong bucket, reported as misplaced rather than attributed.
 *
 * An export revision is judged against the key the route would compute *now* — the same assembly
 * (`currentExportCacheKeys`) the reaper removes by — rather than attributed to any surviving novel.
 * The report is only useful if it states the rule the sweeps act on, and the fingerprint is part of
 * that rule: a revision the content has moved past is residue the daily sweep removes, not an object
 * a novel owns.
 */

export interface StorageAuditInput {
  bucket: StorageBucket;
  /** Every key in the bucket, so keys outside the roots the sweeps scan are seen. */
  keys: readonly string[];
  /** `novels.id` — the row that makes a novel's covers and export cache live. */
  knownNovelIds: ReadonlySet<string>;
  /** `novels.cover_key`: the one cover set a novel's row names. */
  storedCoverSets: ReadonlySet<string>;
  /** `user.id`, so a set under a deleted account is told apart from one its owner replaced. */
  knownUserIds: ReadonlySet<string>;
  /** The set prefix each user row names in `image`. */
  storedAvatarSets: ReadonlySet<string>;
  /** `epub_uploads.object_key`, which is how a staged archive is owned. */
  knownUploadKeys: ReadonlySet<string>;
  /**
   * The export cache keys the route would compute now, for every novel that can be exported: the one
   * rule that tells a current revision from residue. See `currentExportCacheKeys`.
   */
  currentExportKeys: ReadonlySet<string>;
}

export interface UnownedSet {
  kind: StorageObjectKind;
  /** The set an operator would delete, spelled as a prefix delete takes it. */
  set: string;
  /** Why no row names it: the row is gone, or it survives and stopped naming this. */
  why: "owner row is gone" | "owner no longer names this set";
  /** What removes it: the daily storage sweep, or the idle-time avatar script. */
  cleanedBy: "scheduled purge" | "storage:prune-avatars";
  /** The keys in the set, so a report names objects and not only a total. */
  objectKeys: string[];
}

export interface StorageAuditReport {
  bucket: StorageBucket;
  scannedKeys: number;
  /** Keys a surviving row names (or an export cache under a surviving novel). */
  attributedKeys: number;
  /** Sets whose owning row is gone or never named them. */
  unownedSets: UnownedSet[];
  /** Keys whose shape no rule reads: never attributed, never removed. */
  unrecognizedKeys: string[];
  /** Keys a rule reads whose kind belongs in the other bucket. */
  misplacedKeys: string[];
}

/**
 * Whether a surviving row still names this object.
 *
 * An export is the one kind no column stores, so what owns it is the content fingerprint: the key the
 * route would compute now is the revision it can still be reached by, and every other object under a
 * surviving novel is one the export has moved past.
 */
function isOwned(
  owner: StorageObjectOwner,
  key: string,
  set: string,
  input: StorageAuditInput,
): boolean {
  switch (owner.kind) {
    case "cover":
      return input.storedCoverSets.has(set);
    case "avatar":
      return input.storedAvatarSets.has(set);
    case "epub-upload":
      return input.knownUploadKeys.has(set);
    case "export":
      return input.currentExportKeys.has(key);
  }
}

/**
 * Whether the row that would own this set still exists at all.
 *
 * A staged archive is its own set, so a row either names exactly this object or is gone; the other
 * kinds are told apart by whether their owner survives, which is what separates residue a deleted
 * account left behind from residue its owner replaced.
 */
function whyUnowned(owner: StorageObjectOwner, input: StorageAuditInput): UnownedSet["why"] {
  switch (owner.kind) {
    case "cover":
    case "export":
      return input.knownNovelIds.has(owner.novelId)
        ? "owner no longer names this set"
        : "owner row is gone";
    case "avatar":
      return input.knownUserIds.has(owner.userId)
        ? "owner no longer names this set"
        : "owner row is gone";
    case "epub-upload":
      return "owner row is gone";
  }
}

/**
 * The sweep that removes a set no row names.
 *
 * Avatars go with the idle-time script, which diffs every set against the rows; every other kind goes
 * with the daily storage sweep, whose two rules cover both cases — a deleted novel's prefixes, and a
 * surviving novel's superseded cover segments, superseded export revisions and row-less staged
 * archives. There is no third answer: a set nothing would ever remove is what this report used to
 * find, and that residue is what the reaper was added for.
 */
function cleanedBy(kind: StorageObjectKind): UnownedSet["cleanedBy"] {
  return kind === "avatar" ? "storage:prune-avatars" : "scheduled purge";
}

/**
 * Classifies one bucket's listing. Pure: keys in, report out, no storage or database, so
 * the rule a report states is the rule the tests read.
 */
export function auditBucket(input: StorageAuditInput): StorageAuditReport {
  let attributedKeys = 0;
  const unowned = new Map<string, UnownedSet>();
  const unrecognizedKeys: string[] = [];
  const misplacedKeys: string[] = [];

  for (const key of [...input.keys].toSorted()) {
    const owner = ownerOfObjectKey(key);
    if (!owner) {
      unrecognizedKeys.push(key);
      continue;
    }
    if (ownerBucket(owner.kind) !== input.bucket) {
      misplacedKeys.push(key);
      continue;
    }

    // The set a row would name for this owner, addressed the way a delete addresses it.
    const set = setOfOwner(owner);
    if (isOwned(owner, key, set, input)) {
      attributedKeys += 1;
      continue;
    }

    const entry =
      unowned.get(set) ??
      ({
        kind: owner.kind,
        set,
        why: whyUnowned(owner, input),
        cleanedBy: cleanedBy(owner.kind),
        objectKeys: [],
      } satisfies UnownedSet);
    entry.objectKeys.push(key);
    unowned.set(set, entry);
  }

  return {
    bucket: input.bucket,
    scannedKeys: input.keys.length,
    attributedKeys,
    unownedSets: [...unowned.values()].toSorted((left, right) => left.set.localeCompare(right.set)),
    unrecognizedKeys,
    misplacedKeys,
  };
}

function usage(): string {
  return `Usage: bun run storage:audit [--help]

Reports who owns every object in the public and private buckets, and what nothing owns.

Read-only: it lists, classifies and prints. Nothing is deleted and nothing is written, and
it exits 0 whether or not it finds anything, because it is a report rather than a gate.

What it reports:
  unowned set    a rule reads the key but no row names it, with why (the row is gone, or it
                 survives and has moved on) and the sweep that removes it
  no rule        the key's shape was never written by this app, so no sweep will touch it
  misplaced      the key's kind belongs in the other bucket

Environment:
  R2_*         When unset, the filesystem adapter under .tura/storage/ is inspected.
  DATABASE_URL Read for the rows that own objects — novels, users and staged uploads — and
               for the export revision rule that tells a current cache key from residue. It
               must point at the database this bucket belongs to, or every set will look
               unowned.`;
}

function parseCliOptions(args: string[]): { help: boolean } {
  let help = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return { help };
}

interface AuditReferenceData {
  knownNovelIds: ReadonlySet<string>;
  storedCoverSets: ReadonlySet<string>;
  knownUserIds: ReadonlySet<string>;
  storedAvatarSets: ReadonlySet<string>;
  knownUploadKeys: ReadonlySet<string>;
  currentExportKeys: ReadonlySet<string>;
}

/**
 * Reads the rows that own objects, and the revision rule for the exports the listing names.
 *
 * The export lookup is bounded by the bucket: only the novels that actually hold a cached export
 * are asked about, rather than every novel in the database.
 */
async function readReferenceData(
  listings: ReadonlyArray<readonly [StorageBucket, readonly string[]]>,
): Promise<AuditReferenceData> {
  // Loaded here rather than imported at the top, like the database client: `@/lib/env` validates when
  // it first loads, and the revision rule reaches it through the export module.
  const [{ db }, { novels, user, epubUploads }, { isNotNull }, { currentExportCacheKeys }] =
    await Promise.all([
      import("../src/lib/db/index.ts"),
      import("../src/lib/db/schema/index.ts"),
      import("drizzle-orm"),
      import("../src/lib/export/stream.ts"),
    ]);

  const [novelRows, userRows, uploadRows] = await Promise.all([
    db.select({ id: novels.id, coverKey: novels.coverKey }).from(novels),
    db.select({ id: user.id, image: user.image }).from(user).where(isNotNull(user.image)),
    db.select({ objectKey: epubUploads.objectKey }).from(epubUploads),
  ]);

  const exportNovelIds = new Set<string>();
  for (const [, keys] of listings) {
    for (const key of keys) {
      const stored = parseObjectKey(key);
      if (stored?.owner.kind === "export") exportNovelIds.add(stored.owner.novelId);
    }
  }

  return {
    knownNovelIds: new Set(novelRows.map((row) => row.id)),
    storedCoverSets: new Set(
      novelRows.flatMap((row) => (row.coverKey === null ? [] : [row.coverKey])),
    ),
    knownUserIds: new Set(userRows.map((row) => row.id)),
    // A value that is not an avatar prefix cannot be a set, and resolving it is the
    // profile's job: an address in that column owns no objects here.
    storedAvatarSets: new Set(
      userRows.flatMap((row) =>
        typeof row.image === "string" && parseAvatarPrefix(row.image) !== null ? [row.image] : [],
      ),
    ),
    knownUploadKeys: new Set(uploadRows.map((row) => row.objectKey)),
    currentExportKeys: await currentExportCacheKeys([...exportNovelIds]),
  };
}

function reportStorageAudit(report: StorageAuditReport): void {
  log("info", "storage audit: inspected a bucket", {
    bucket: report.bucket,
    keys: report.scannedKeys,
    attributed: report.attributedKeys,
    unownedSets: report.unownedSets.length,
    unrecognized: report.unrecognizedKeys.length,
    misplaced: report.misplacedKeys.length,
  });

  for (const set of report.unownedSets) {
    log("warn", "storage audit: no row owns this set", {
      set: set.set,
      kind: set.kind,
      objects: set.objectKeys.length,
      why: set.why,
      cleanedBy: set.cleanedBy,
    });
  }
  for (const key of report.unrecognizedKeys) {
    log("warn", "storage audit: no rule reads this key", { key });
  }
  for (const key of report.misplacedKeys) {
    log("warn", "storage audit: key is in the wrong bucket", { key });
  }
}

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }

  loadEnv({ path: ".env.local" });
  loadEnv();

  const { getPrivateStorage, getPublicStorage } =
    await import("../src/lib/storage/index.server.ts");

  // `listKeys("")` is the whole bucket. The sweeps scan their own roots; an audit that
  // did the same could never show what sits outside them. The listings come first because
  // what owns an export is the revision rule applied to the novels the listing names.
  const listings: Array<readonly [StorageBucket, readonly string[]]> = [];
  for (const [bucket, storage] of [
    ["public", getPublicStorage()],
    ["private", getPrivateStorage()],
  ] as const) {
    const keys = await storage.listKeys(WHOLE_BUCKET);
    // An unlistable bucket is not an empty one. Refusing beats reporting a clean audit
    // — or a small one — from a listing that never happened.
    if (keys === null) {
      throw new Error(`The ${bucket} bucket could not be listed; the audit is incomplete.`);
    }
    listings.push([bucket, keys]);
  }

  const reference = await readReferenceData(listings);
  const reports: StorageAuditReport[] = [];
  for (const [bucket, keys] of listings) {
    const report = auditBucket({ bucket, keys, ...reference });
    reports.push(report);
    reportStorageAudit(report);
  }

  const unownedSets = reports.flatMap((report) => report.unownedSets);
  const unrecognized = reports.reduce((total, report) => total + report.unrecognizedKeys.length, 0);
  const bySweep = (sweep: UnownedSet["cleanedBy"]) =>
    unownedSets.filter((set) => set.cleanedBy === sweep).length;

  console.log(
    `\nAudited ${reports.reduce((total, report) => total + report.scannedKeys, 0)} object(s): ` +
      `${unownedSets.length} unowned set(s) — ${bySweep("scheduled purge")} the daily storage ` +
      `sweep removes, ${bySweep("storage:prune-avatars")} the avatar script — and ` +
      `${unrecognized} key(s) no rule can attribute. Nothing was deleted.`,
  );
}

if (import.meta.main) {
  main()
    .then(async () => {
      const { queryClient } = await import("../src/lib/db/index.ts");
      await queryClient.end({ timeout: 1 });
    })
    .catch(async (error: unknown) => {
      console.error(
        "Storage audit failed:",
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      const { queryClient } = await import("../src/lib/db/index.ts");
      await queryClient.end({ timeout: 1 }).catch(() => {});
    });
}
