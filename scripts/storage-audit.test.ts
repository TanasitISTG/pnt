import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  avatarPrefix,
  coverPrefix,
  epubUploadKey,
  exportKeyPrefix,
  exportObjectKey,
} from "@/lib/storage/keys";

import { auditBucket, type StorageAuditInput } from "./storage-audit";

const NOVEL = "novel-1";
const USER = "user-1";
const COVER_SET = coverPrefix(NOVEL, "segment-1");
const AVATAR_SET = avatarPrefix(USER, "photo");
/** The revision the content is on now, and one the content has moved past. */
const CURRENT_EXPORT = exportObjectKey(NOVEL, "abc123", "epub");
const SUPERSEDED_EXPORT = exportObjectKey(NOVEL, "older4", "epub");

/** A bucket with every set named by a row, which each case then empties in one place. */
function bucketInput(overrides: Partial<StorageAuditInput> = {}): StorageAuditInput {
  return {
    bucket: "public",
    keys: [],
    knownNovelIds: new Set([NOVEL]),
    storedCoverSets: new Set([COVER_SET]),
    knownUserIds: new Set([USER]),
    storedAvatarSets: new Set([AVATAR_SET]),
    knownUploadKeys: new Set(),
    currentExportKeys: new Set([CURRENT_EXPORT]),
    ...overrides,
  };
}

function setNames(input: StorageAuditInput): string[] {
  return auditBucket(input).unownedSets.map((set) => set.set);
}

describe("auditBucket", () => {
  it("attributes every kind to the row that names it", () => {
    const report = auditBucket(
      bucketInput({
        keys: [
          `${COVER_SET}/original`,
          `${COVER_SET}/640.webp`,
          `${AVATAR_SET}/64.webp`,
          "covers/never-named/segment/original",
          "avatars/user-2/photo/64.webp",
        ],
        knownNovelIds: new Set([NOVEL, "never-named"]),
        storedCoverSets: new Set([COVER_SET, "covers/never-named/segment"]),
        storedAvatarSets: new Set([AVATAR_SET, "avatars/user-2/photo"]),
      }),
    );

    expect(report.scannedKeys).toBe(5);
    expect(report.attributedKeys).toBe(5);
    expect(report.unownedSets).toEqual([]);
    expect(report.unrecognizedKeys).toEqual([]);
    expect(report.misplacedKeys).toEqual([]);
  });

  it("groups an unowned set's objects and names the sweep that removes it", () => {
    const report = auditBucket(
      bucketInput({
        keys: ["covers/novel-gone/segment/640.webp", "covers/novel-gone/segment/original"],
      }),
    );

    expect(report.attributedKeys).toBe(0);
    expect(report.unownedSets).toEqual([
      {
        kind: "cover",
        set: "covers/novel-gone/segment",
        why: "owner row is gone",
        cleanedBy: "scheduled purge",
        objectKeys: ["covers/novel-gone/segment/640.webp", "covers/novel-gone/segment/original"],
      },
    ]);
  });

  it("reports a superseded cover segment under a surviving novel as the reaper's work", () => {
    // The novel survives with a different segment, so the deletion that should have removed this one
    // never landed: the daily sweep's reaper is what covers it.
    const report = auditBucket(bucketInput({ keys: ["covers/novel-1/older-segment/640.webp"] }));

    expect(report.unownedSets).toEqual([
      {
        kind: "cover",
        set: "covers/novel-1/older-segment",
        why: "owner no longer names this set",
        cleanedBy: "scheduled purge",
        objectKeys: ["covers/novel-1/older-segment/640.webp"],
      },
    ]);
  });

  it("counts an avatar set the avatar script would remove as swept", () => {
    // The script diffs every set against the rows rather than checking that the user
    // exists, so a stale set for a live user is still cleaned up.
    const report = auditBucket(bucketInput({ keys: ["avatars/user-1/oldphoto/64.webp"] }));

    expect(report.unownedSets).toEqual([
      {
        kind: "avatar",
        set: "avatars/user-1/oldphoto",
        why: "owner no longer names this set",
        cleanedBy: "storage:prune-avatars",
        objectKeys: ["avatars/user-1/oldphoto/64.webp"],
      },
    ]);
  });

  it("tells a deleted account's avatar set apart from one its owner replaced", () => {
    const gone = auditBucket(
      bucketInput({ keys: ["avatars/user-gone/photo/64.webp"], knownUserIds: new Set() }),
    );

    expect(gone.unownedSets[0].why).toBe("owner row is gone");
  });

  it("reports a staged archive no row names as the reaper's work rather than operator work", () => {
    const key = epubUploadKey("upload-7");

    const stranded = auditBucket(
      bucketInput({ bucket: "private", keys: [key], knownUploadKeys: new Set() }),
    );
    expect(stranded.unownedSets).toEqual([
      {
        kind: "epub-upload",
        set: key,
        why: "owner row is gone",
        cleanedBy: "scheduled purge",
        objectKeys: [key],
      },
    ]);

    const owned = auditBucket(
      bucketInput({ bucket: "private", keys: [key], knownUploadKeys: new Set([key]) }),
    );
    expect(owned.attributedKeys).toBe(1);
    expect(owned.unownedSets).toEqual([]);
  });

  it("attributes the current export revision and reports the ones the content moved past", () => {
    // The cover and avatar rows are irrelevant to an export key, so this bucket holds none of them.
    const privateBucket: Partial<StorageAuditInput> = {
      bucket: "private",
      storedCoverSets: new Set(),
      storedAvatarSets: new Set(),
    };

    const current = auditBucket(bucketInput({ ...privateBucket, keys: [CURRENT_EXPORT] }));
    expect(current.attributedKeys).toBe(1);
    expect(current.unownedSets).toEqual([]);

    const superseded = auditBucket(bucketInput({ ...privateBucket, keys: [SUPERSEDED_EXPORT] }));
    expect(superseded.attributedKeys).toBe(0);
    expect(superseded.unownedSets).toEqual([
      {
        kind: "export",
        set: exportKeyPrefix(NOVEL),
        why: "owner no longer names this set",
        cleanedBy: "scheduled purge",
        objectKeys: [SUPERSEDED_EXPORT],
      },
    ]);
  });

  it("sweeps a deleted novel's exports as orphaned rather than superseded", () => {
    const goneInput = bucketInput({
      bucket: "private",
      keys: ["exports/novel-gone/abc123.epub", "exports/novel-gone/def456.txt"],
      storedCoverSets: new Set(),
      storedAvatarSets: new Set(),
    });

    expect(setNames(goneInput)).toEqual([exportKeyPrefix("novel-gone")]);
    expect(auditBucket(goneInput).unownedSets[0]).toMatchObject({
      why: "owner row is gone",
      cleanedBy: "scheduled purge",
    });
  });

  it("names every key whose shape no rule reads instead of attributing it", () => {
    const report = auditBucket(
      bucketInput({
        keys: [
          "covers/only-two-parts",
          "covers/novel-1/segment-1",
          "covers/novel-1/segment-1/",
          "covers-archive/novel-1/segment-1/640.webp",
          "avatars/user-1",
          "epub-uploads/upload-1/extra",
          "notes.txt",
        ],
      }),
    );

    expect(report.attributedKeys).toBe(0);
    expect(report.unownedSets).toEqual([]);
    expect(report.unrecognizedKeys).toEqual([
      "avatars/user-1",
      "covers-archive/novel-1/segment-1/640.webp",
      "covers/novel-1/segment-1",
      "covers/novel-1/segment-1/",
      "covers/only-two-parts",
      "epub-uploads/upload-1/extra",
      "notes.txt",
    ]);
  });

  it("reports a key whose kind belongs in the other bucket as misplaced", () => {
    const privateCover = auditBucket(
      bucketInput({ bucket: "private", keys: ["covers/novel-1/segment-1/640.webp"] }),
    );
    expect(privateCover.misplacedKeys).toEqual(["covers/novel-1/segment-1/640.webp"]);
    expect(privateCover.attributedKeys).toBe(0);
    expect(privateCover.unownedSets).toEqual([]);

    const publicUpload = auditBucket(
      bucketInput({ keys: [epubUploadKey("upload-1")], knownUploadKeys: new Set() }),
    );
    expect(publicUpload.misplacedKeys).toEqual([epubUploadKey("upload-1")]);
  });

  it("reports an empty bucket as an empty audit rather than nothing at all", () => {
    expect(auditBucket(bucketInput())).toEqual({
      bucket: "public",
      scannedKeys: 0,
      attributedKeys: 0,
      unownedSets: [],
      unrecognizedKeys: [],
      misplacedKeys: [],
    });
  });
});

describe("the audit command", () => {
  const source = readFileSync(
    join(fileURLToPath(new URL("../", import.meta.url)), "scripts/storage-audit.ts"),
    "utf8",
  );

  it("removes nothing, so an audit can never be a cleanup", () => {
    for (const mutation of [/deletePrefix\(/, /\.delete\(/, /unlink\(/, /\brm\(/]) {
      expect(source).not.toMatch(mutation);
    }
  });

  it("lists the whole bucket rather than the roots the sweeps scan", () => {
    expect(source).toContain('listKeys("")');
  });
});
