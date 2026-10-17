import { describe, expect, it } from "vitest";

import {
  avatarPrefix,
  coverPrefix,
  epubUploadKey,
  exportKeyPrefix,
  isObjectKeyPrefix,
  ownerOfObjectKey,
  setOfOwner,
} from "@/lib/storage/keys";

import {
  changesBetween,
  describeFootprintCleanup,
  type FootprintCleanup,
} from "./bucket-footprint";

const COVER_SET = coverPrefix("novel-1", "segment-1");
const OTHER_COVER_SET = coverPrefix("novel-10", "segment-1");
const AVATAR_SET = avatarPrefix("user-1", "photo");
const EXPORT_SET = exportKeyPrefix("novel-1");
const UPLOAD_SET = epubUploadKey("upload-1");

/** The keys a run of each kind writes, so every case reads as the set it is about. */
const COVER_KEYS = [`${COVER_SET}/original`, `${COVER_SET}/640.webp`];

function removal(overrides: Partial<FootprintCleanup> = {}): FootprintCleanup {
  return {
    bucket: "public",
    removedSets: [],
    removedKeys: 0,
    failures: [],
    addedToExistingSets: [],
    unrecognizedKeys: [],
    listed: true,
    ...overrides,
  };
}

describe("changesBetween", () => {
  it("names a set the run created, with the keys that prove it", () => {
    const changes = changesBetween([], COVER_KEYS);

    expect(changes.addedSets).toEqual([
      { set: COVER_SET, kind: "cover", keys: [...COVER_KEYS].toSorted() },
    ]);
    expect(changes.addedToExistingSets).toEqual([]);
    expect(changes.unrecognizedKeys).toEqual([]);
  });

  it("leaves a set that already held an object, and reports the key it gained", () => {
    const changes = changesBetween([COVER_KEYS[0]], [`${COVER_SET}/480.webp`]);

    // The run did not create this set, so removing it would take the object the run never
    // wrote. The key it added is named instead of swept.
    expect(changes.addedSets).toEqual([]);
    expect(changes.addedToExistingSets).toEqual([`${COVER_SET}/480.webp`]);
  });

  it("leaves a set the run emptied and refilled, because it existed before the run", () => {
    // The old key is gone and a new one stands where it stood: the set is still not this
    // run's to delete, and the run's own object is what an operator would have to finish.
    const changes = changesBetween([`${COVER_SET}/original`], [`${COVER_SET}/640.webp`]);

    expect(changes.addedSets).toEqual([]);
    expect(changes.addedToExistingSets).toEqual([`${COVER_SET}/640.webp`]);
  });

  it("says nothing about an object the run removed, or one it rewrote", () => {
    const changes = changesBetween(
      [...COVER_KEYS, `${AVATAR_SET}/64.webp`],
      [`${AVATAR_SET}/64.webp`],
    );

    expect(changes.addedSets).toEqual([]);
    expect(changes.addedToExistingSets).toEqual([]);
    expect(changes.unrecognizedKeys).toEqual([]);
  });

  it("keeps one novel's set apart from a novel whose id merely starts the same way", () => {
    const changes = changesBetween([], [`${COVER_SET}/original`, `${OTHER_COVER_SET}/original`]);

    expect(changes.addedSets.map((entry) => entry.set)).toEqual([COVER_SET, OTHER_COVER_SET]);
  });

  it("groups a set's objects into one removal, whatever order the listing arrives in", () => {
    const changes = changesBetween([], [...COVER_KEYS, `${AVATAR_SET}/original`].toReversed());

    expect(changes.addedSets).toEqual([
      { set: AVATAR_SET, kind: "avatar", keys: [`${AVATAR_SET}/original`] },
      { set: COVER_SET, kind: "cover", keys: [...COVER_KEYS].toSorted() },
    ]);
  });

  it("reports a key the run added that no rule reads, rather than removing it", () => {
    const changes = changesBetween([], ["covers/only-two-parts", "notes.txt", ...COVER_KEYS]);

    expect(changes.unrecognizedKeys).toEqual(["covers/only-two-parts", "notes.txt"]);
    expect(changes.addedSets.map((entry) => entry.set)).toEqual([COVER_SET]);
  });

  it("finds a set of every kind the vocabulary derives, addressed as a prefix delete takes it", () => {
    const listed = [
      `${AVATAR_SET}/original`,
      `${EXPORT_SET}/abc123.txt`,
      `${UPLOAD_SET}`,
      `${COVER_SET}/320.webp`,
    ];

    const changes = changesBetween([], listed);

    expect(changes.addedSets.map((entry) => [entry.set, entry.kind])).toEqual([
      [AVATAR_SET, "avatar"],
      [COVER_SET, "cover"],
      [UPLOAD_SET, "epub-upload"],
      [EXPORT_SET, "export"],
    ]);
    // Every set this sweep removes is one the port accepts: a returned prefix the vocabulary
    // does not derive would be refused at the bucket instead of removing anything.
    for (const entry of changes.addedSets) {
      expect(isObjectKeyPrefix(entry.set)).toBe(true);
    }
  });

  it("addresses a set through the same rule the audit attributes one with", () => {
    // One owner, one set: what the audit names and what a removal deletes cannot disagree.
    for (const [key, set] of [
      [`${COVER_SET}/640.webp`, COVER_SET],
      [`${AVATAR_SET}/64.webp`, AVATAR_SET],
      [`${EXPORT_SET}/abc123.epub`, EXPORT_SET],
      [UPLOAD_SET, UPLOAD_SET],
    ] as const) {
      const owner = ownerOfObjectKey(key);
      expect(owner === null ? null : setOfOwner(owner)).toBe(set);
      expect(changesBetween([], [key]).addedSets.map((entry) => entry.set)).toEqual([set]);
    }
  });
});

describe("describeFootprintCleanup", () => {
  it("says nothing when the run left nothing and removed nothing", () => {
    expect(describeFootprintCleanup([removal(), removal({ bucket: "private" })])).toBeNull();
  });

  it("counts what it removed across both buckets", () => {
    const line = describeFootprintCleanup([
      removal({ removedSets: [COVER_SET], removedKeys: 2 }),
      removal({ bucket: "private", removedSets: [UPLOAD_SET], removedKeys: 1 }),
    ]);

    expect(line).toBe("removed 3 object(s) in 2 set(s) this run created");
  });

  it("names what an operator still has to finish", () => {
    const line = describeFootprintCleanup([
      removal({
        removedSets: [COVER_SET],
        removedKeys: 2,
        failures: [{ key: UPLOAD_SET, message: "R2 DELETE refused" }],
      }),
      removal({ bucket: "private", listed: false }),
    ]);

    expect(line).toBe(
      "removed 2 object(s) in 1 set(s) this run created, 1 object(s) could not be removed, private bucket(s) could not be listed",
    );
  });
});
