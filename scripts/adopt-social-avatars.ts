import { config as loadEnv } from "dotenv";

import { log } from "@/lib/log";
import { isProviderAvatarUrl } from "@/lib/profile/social-avatar.server";

/**
 * Adopts the Google/Discord profile photo of accounts created before the sign-up hook
 * did it for new ones.
 *
 * Those rows hold the provider's URL in `user.image`, a column that otherwise stores an
 * avatar *prefix* in our own bucket. The value therefore never resolved — the reader
 * sees initials instead of the photo they already have on the platform — and no cleanup
 * path can remove bytes we do not own. Each candidate is mirrored through the same
 * validated, re-encoded avatar set a social sign-up now uses.
 *
 * A row whose photo cannot be fetched is left exactly as it is and reported, so a
 * transient failure at the provider is recoverable by re-running: the source address is
 * the only copy of it we have, and discarding it would be the one irreversible mistake
 * this script could make. Run it while the app is idle; `--dry-run` prints the plan.
 */

export interface AdoptCandidate {
  id: string;
  image: string;
}

export interface AdoptProviderAvatarsDeps {
  candidates: readonly AdoptCandidate[];
  /** Stores a copy and returns its key prefix, or null when it cannot be adopted. */
  mirror: (userId: string, remoteUrl: string) => Promise<string | null>;
  /**
   * Whether the photo is retrievable, without storing it. A dry run must not leave
   * objects behind in the public bucket, so it asks this instead of the mirror.
   */
  probe: (remoteUrl: string) => Promise<boolean>;
  /** Writes the column; the callers below are the only writers. */
  save: (userId: string, imageKey: string) => Promise<void>;
  dryRun: boolean;
}

export interface AdoptProviderAvatarsResult {
  /** Rows whose photo is now stored under `avatars/`. */
  adopted: string[];
  /** Values that are not provider addresses, left untouched. */
  skipped: string[];
  /** Rows the provider would not hand over; safe to retry. */
  failed: Array<{ id: string; message: string }>;
}

/**
 * Drains the candidates, mirroring one photo at a time: the fetch and the re-encode are
 * already bounded per row, and a batch here is a handful of accounts rather than a
 * throughput problem.
 */
export async function adoptProviderAvatars({
  candidates,
  mirror,
  probe,
  save,
  dryRun,
}: AdoptProviderAvatarsDeps): Promise<AdoptProviderAvatarsResult> {
  const result: AdoptProviderAvatarsResult = { adopted: [], skipped: [], failed: [] };

  for (const candidate of candidates) {
    if (!isProviderAvatarUrl(candidate.image)) {
      result.skipped.push(candidate.id);
      continue;
    }

    try {
      if (dryRun) {
        if (await probe(candidate.image)) result.adopted.push(candidate.id);
        else result.failed.push({ id: candidate.id, message: "provider photo is not retrievable" });
        continue;
      }

      const imageKey = await mirror(candidate.id, candidate.image);
      if (!imageKey) {
        // Left as found on purpose: see the note above about the source address.
        result.failed.push({ id: candidate.id, message: "provider photo could not be adopted" });
        continue;
      }

      await save(candidate.id, imageKey);
      result.adopted.push(candidate.id);
    } catch (error) {
      result.failed.push({
        id: candidate.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

function usage(): string {
  return [
    "Usage: bun run avatars:adopt-social [--dry-run]",
    "",
    "Copies the Google/Discord profile photo of existing accounts into avatar storage",
    "and points their user row at the copy, so the photo their account already had on",
    "the platform is the one the app renders.",
    "",
    "  --dry-run   Report what would be adopted without writing anything",
  ].join("\n");
}

function parseCliOptions(args: string[]): { dryRun: boolean; help: boolean } {
  let dryRun = false;
  let help = false;
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  return { dryRun, help };
}

async function readCandidates(): Promise<AdoptCandidate[]> {
  const [{ db }, { user }, { isNotNull }] = await Promise.all([
    import("../src/lib/db/index.ts"),
    import("../src/lib/db/schema/index.ts"),
    import("drizzle-orm"),
  ]);

  const rows = await db
    .select({ id: user.id, image: user.image })
    .from(user)
    .where(isNotNull(user.image));

  return rows.flatMap((row) =>
    typeof row.image === "string" ? [{ id: row.id, image: row.image }] : [],
  );
}

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }

  loadEnv({ path: ".env.local" });
  loadEnv();

  const [{ fetchProviderAvatar, mirrorProviderAvatar }, { db }, { user }, { eq }] =
    await Promise.all([
      import("../src/lib/profile/social-avatar.server.ts"),
      import("../src/lib/db/index.ts"),
      import("../src/lib/db/schema/index.ts"),
      import("drizzle-orm"),
    ]);

  const candidates = await readCandidates();
  log("info", "adopting provider profile photos", {
    candidates: candidates.length,
    dryRun: cli.dryRun,
  });

  const result = await adoptProviderAvatars({
    candidates,
    mirror: mirrorProviderAvatar,
    probe: async (remoteUrl) => (await fetchProviderAvatar(remoteUrl)) !== null,
    save: async (userId, imageKey) => {
      await db.update(user).set({ image: imageKey }).where(eq(user.id, userId));
    },
    dryRun: cli.dryRun,
  });

  log("info", "provider photo adoption finished", {
    adopted: result.adopted.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  });
  for (const id of result.adopted) {
    log("info", cli.dryRun ? "would adopt provider photo" : "adopted provider photo", {
      userId: id,
    });
  }
  for (const failure of result.failed) {
    log("warn", "provider photo left as found", { userId: failure.id, reason: failure.message });
  }

  if (cli.dryRun) {
    console.log(
      `\nDry run: ${result.adopted.length} account(s) would adopt their provider photo. Re-run without --dry-run to apply.`,
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
      console.error(
        "Provider photo adoption failed:",
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
      const { queryClient } = await import("../src/lib/db/index.ts");
      await queryClient.end({ timeout: 1 }).catch(() => {});
    });
}
