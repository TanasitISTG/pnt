import { config as loadEnv } from "dotenv";

import { log } from "@/lib/log";
import { AVATAR_KEY_ROOT, avatarObjectKeyPrefix, parseAvatarPrefix } from "@/lib/storage/keys";

/**
 * Deletes avatar object sets that no user row points at any more.
 *
 * Replacing a photo deletes the set it replaces, so an orphan means something did not
 * get that far: a user row removed, or a write-back that failed after the objects had
 * been written. Avatars share the public bucket with covers, so the sweep only ever
 * looks under `avatars/` and only at prefixes a user row could have stored.
 *
 * Run for real by default, like `storage:migrate`; `--dry-run` prints the plan.
 * Run it while the app is idle: an upload writes its objects before it writes the row,
 * so a sweep running in that window would see a set that is not referenced *yet*. The
 * second reference read narrows that window to a single failed upload, and does not
 * close it entirely.
 */

export interface AvatarSweepStorage {
  /** Every key under a prefix, or null when the bucket could not be listed. */
  listKeys(prefix: string): Promise<string[] | null>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface AvatarSweepResult {
  /** Objects listed under `avatars/`. */
  scanned: number;
  /** Keys there whose shape is not an avatar object key; never touched. */
  unrecognized: number;
  /** Sets no user row points at, decided from the listing. */
  orphanPrefixes: string[];
  /** Sets left alone because a later read found a row pointing at them. */
  referencedSinceListing: string[];
  deletedPrefixes: string[];
  failures: Array<{ prefix: string; message: string }>;
}

/**
 * Groups stored objects into the sets a user row could point at, keeping only the
 * ones nothing references. Anything that is not an avatar object key is counted and
 * left alone, so a key that merely sits in the same bucket can never be deleted.
 */
export function selectOrphanAvatarPrefixes(
  keys: readonly string[],
  referencedPrefixes: ReadonlySet<string>,
): { orphanPrefixes: string[]; unrecognized: number } {
  const orphanPrefixes = new Set<string>();
  let unrecognized = 0;

  for (const key of keys) {
    const prefix = avatarObjectKeyPrefix(key);
    if (prefix === null) {
      unrecognized += 1;
      continue;
    }
    if (!referencedPrefixes.has(prefix)) orphanPrefixes.add(prefix);
  }

  return { orphanPrefixes: [...orphanPrefixes].toSorted(), unrecognized };
}

/**
 * Lists the bucket, diffs it against the rows that reference a photo set, and removes
 * what is left over. A dry run stops after the diff, so it reads the rows once and
 * deletes nothing.
 */
export async function sweepOrphanAvatars(
  storage: AvatarSweepStorage,
  readReferencedPrefixes: () => Promise<ReadonlySet<string>>,
  options: { dryRun: boolean },
): Promise<AvatarSweepResult> {
  const keys = await storage.listKeys(AVATAR_KEY_ROOT);
  // An unlistable bucket is not an empty one. Refusing beats reporting a clean sweep
  // — or deleting anything — from a listing that never happened.
  if (keys === null) {
    throw new Error("The public bucket could not be listed; nothing was deleted.");
  }

  const referenced = await readReferencedPrefixes();
  const { orphanPrefixes, unrecognized } = selectOrphanAvatarPrefixes(keys, referenced);
  const result: AvatarSweepResult = {
    scanned: keys.length,
    unrecognized,
    orphanPrefixes,
    referencedSinceListing: [],
    deletedPrefixes: [],
    failures: [],
  };
  if (options.dryRun) return result;

  // The row is written last, so a set that became referenced while the listing was in
  // flight is a live upload, not an orphan.
  const nowReferenced = await readReferencedPrefixes();

  for (const prefix of orphanPrefixes) {
    if (nowReferenced.has(prefix)) {
      result.referencedSinceListing.push(prefix);
      continue;
    }
    try {
      await storage.deletePrefix(prefix);
      result.deletedPrefixes.push(prefix);
    } catch (error) {
      result.failures.push({
        prefix,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function usage(): string {
  return `Usage: bun run storage:prune-avatars [--dry-run]

Deletes avatar object sets in the public bucket that no user row references.

Options:
  --dry-run  List what would be deleted without deleting anything
  --help     Show this help

Environment:
  R2_*   When unset, the filesystem adapter under .tura/storage/ is swept instead.

Reads the database for the stored profile photo of every user, so DATABASE_URL must
point at the database this bucket belongs to. Safe to re-run: an empty result is the
normal outcome of a clean database.`;
}

interface CliOptions {
  dryRun: boolean;
  help: boolean;
}

function parseCliOptions(args: string[]): CliOptions {
  let dryRun = false;
  let help = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return { dryRun, help };
}

async function readReferencedAvatarPrefixes(): Promise<Set<string>> {
  const [{ db }, { user }, { isNotNull }] = await Promise.all([
    import("../src/lib/db/index.ts"),
    import("../src/lib/db/schema/index.ts"),
    import("drizzle-orm"),
  ]);

  const rows = await db.select({ image: user.image }).from(user).where(isNotNull(user.image));

  const prefixes = new Set<string>();
  for (const row of rows) {
    // A stored value that is not an avatar prefix cannot match one, and is ignored
    // rather than reported: resolving it is the profile's job, not the sweep's.
    if (row.image !== null && parseAvatarPrefix(row.image)) prefixes.add(row.image);
  }
  return prefixes;
}

function report(result: AvatarSweepResult, dryRun: boolean): void {
  log("info", "avatar sweep: inspected the public bucket", {
    scanned: result.scanned,
    unrecognized: result.unrecognized,
    orphans: result.orphanPrefixes.length,
    referencedSinceListing: result.referencedSinceListing.length,
    deleted: result.deletedPrefixes.length,
    failed: result.failures.length,
  });

  for (const prefix of result.orphanPrefixes) {
    log("info", dryRun ? "avatar sweep: would delete" : "avatar sweep: deleting", { prefix });
  }
  for (const prefix of result.referencedSinceListing) {
    log("info", "avatar sweep: kept, a row now points at it", { prefix });
  }
  for (const failure of result.failures) {
    log("error", "avatar sweep: could not delete", {
      prefix: failure.prefix,
      error: failure.message,
    });
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

  const { getPublicStorage } = await import("../src/lib/storage/index.server.ts");
  const storage = getPublicStorage();

  const result = await sweepOrphanAvatars(storage, readReferencedAvatarPrefixes, {
    dryRun: cli.dryRun,
  });
  report(result, cli.dryRun);

  if (result.failures.length > 0) {
    throw new Error(`${result.failures.length} avatar set(s) could not be deleted`);
  }
  if (cli.dryRun) {
    console.log(
      `\nDry run: ${result.orphanPrefixes.length} orphaned avatar set(s) would be deleted. Re-run without --dry-run to remove them.`,
    );
  }
}

if (import.meta.main) {
  main()
    .then(async () => {
      const { queryClient } = await import("../src/lib/db/index.ts");
      await queryClient.end({ timeout: 1 });
    })
    .catch(async (error: unknown) => {
      console.error("Avatar sweep failed:", error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      const { queryClient } = await import("../src/lib/db/index.ts");
      await queryClient.end({ timeout: 1 }).catch(() => {});
    });
}
