import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AVATAR_KEY_ROOT,
  AVATAR_WIDTHS,
  avatarObjectKeyPrefix,
  avatarOriginalKey,
  avatarPrefix,
  avatarProxyPath,
  avatarVariantKey,
  COVER_WIDTHS,
  coverOwnerPrefix,
  defaultAvatarWidth,
  exportKeyPrefix,
  isObjectKeyPrefix,
  keySetName,
  keySetScope,
  setOfOwner,
  ownerBucket,
  ownerOfObjectKey,
  parseAvatarPrefix,
  coverObjectKey,
  coverOriginalKey,
  coverPrefix,
  coverVariantKey,
  defaultCoverWidth,
  epubUploadKey,
  exportObjectKey,
  exportRevision,
  EXPORT_FORMAT_VERSION,
  type KeySetPrefix,
} from "./keys";

/**
 * A set read back out of a string, the way the app reads a stored or listed value back: the one door
 * from a raw string into the type a bucket takes.
 *
 * A cast would be shorter and would assert nothing. Reading it back means a fixture that the
 * vocabulary would refuse fails here instead of quietly becoming a set.
 */
function derivedPrefix(value: string): KeySetPrefix {
  if (!isObjectKeyPrefix(value)) {
    throw new Error(`test fixture is not a key set the vocabulary derives: "${value}"`);
  }
  return value;
}

describe("storage keys", () => {
  it("keeps covers under a per-novel prefix with an unguessable segment", () => {
    const prefix = coverPrefix("novel-1", "segment-1");
    expect(prefix).toBe("covers/novel-1/segment-1");
    expect(coverOriginalKey(prefix)).toBe("covers/novel-1/segment-1/original");
    expect(coverVariantKey(prefix, 480)).toBe("covers/novel-1/segment-1/480.webp");
    expect(coverObjectKey(prefix, "extra")).toBe("covers/novel-1/segment-1/extra");
  });

  it("defaults to the widest variant", () => {
    expect(defaultCoverWidth()).toBe(COVER_WIDTHS[COVER_WIDTHS.length - 1]);
  });

  it("keeps avatars under a per-user prefix with an unguessable segment", () => {
    const prefix = avatarPrefix("user-1", "segment-1");
    expect(prefix).toBe("avatars/user-1/segment-1");
    expect(avatarOriginalKey(prefix)).toBe("avatars/user-1/segment-1/original");
    expect(avatarVariantKey(prefix, 128)).toBe("avatars/user-1/segment-1/128.webp");
    expect(defaultAvatarWidth()).toBe(AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1]);
  });

  it("round-trips an avatar prefix and rejects any other shape", () => {
    expect(parseAvatarPrefix("avatars/user-1/segment-1")).toEqual({
      userId: "user-1",
      segment: "segment-1",
    });
    for (const value of [
      "",
      "avatars",
      "avatars/user-1",
      "avatars/user-1/segment-1/extra",
      "covers/user-1/segment-1",
      `${AVATAR_KEY_ROOT}//segment-1`,
    ]) {
      expect(parseAvatarPrefix(value)).toBeNull();
    }
  });

  it("groups avatar objects by the prefix a user row stores", () => {
    const prefix = avatarPrefix("user-1", "segment-1");

    for (const key of [avatarOriginalKey(prefix), avatarVariantKey(prefix, 64)]) {
      expect(avatarObjectKeyPrefix(key)).toBe(prefix);
    }
    // Anything deeper than `<prefix>/<file>` still belongs to that set, which is what a
    // prefix delete would remove anyway.
    expect(avatarObjectKeyPrefix(`${prefix}/extra/deeper`)).toBe(prefix);
    for (const key of [
      prefix,
      "avatars/user-1",
      "avatars",
      "",
      "covers/novel-1/segment-1/640.webp",
      "avatars-archive/user-1/segment-1/640.webp",
    ]) {
      expect(avatarObjectKeyPrefix(key)).toBeNull();
    }
  });

  it("addresses the fallback route by the same segment the key carries", () => {
    expect(avatarProxyPath("user-1", "segment-1", 64)).toBe("/api/avatars/user-1/segment-1?w=64");
  });

  it("keys staged EPUB archives and exports by their identifying data", () => {
    expect(epubUploadKey("upload-1")).toBe("epub-uploads/upload-1");
    expect(exportObjectKey("novel-1", "abc123", "epub")).toBe("exports/novel-1/abc123.epub");
  });
});

describe("a key set and the scope it resolves to", () => {
  it("names the set without a separator, so one set has one spelling", () => {
    expect(keySetName(derivedPrefix("avatars/user-1/segment-1"))).toBe("avatars/user-1/segment-1");
    expect(keySetName(derivedPrefix("avatars/user-1/segment-1/"))).toBe("avatars/user-1/segment-1");
    // No prefix at all stays the whole bucket in both spellings.
    expect(keySetName(derivedPrefix(""))).toBe("");
  });

  it("resolves a name and a boundary in one call, so the port reads a prefix once", () => {
    expect(keySetScope(AVATAR_KEY_ROOT)).toEqual({ name: "avatars", boundary: "avatars/" });
    expect(keySetScope(derivedPrefix("covers/novel-1/segment-1"))).toEqual({
      name: "covers/novel-1/segment-1",
      boundary: "covers/novel-1/segment-1/",
    });
    // Both spellings of one set resolve to one scope, so a caller's trailing separator
    // cannot mean a different set than the same name without one.
    expect(keySetScope(derivedPrefix("covers/novel-1/segment-1/"))).toEqual(
      keySetScope(derivedPrefix("covers/novel-1/segment-1")),
    );
    expect(keySetScope(derivedPrefix(""))).toEqual({ name: "", boundary: "" });
  });

  it("keeps a set from reaching a key that merely starts with the same characters", () => {
    const avatars = keySetScope(AVATAR_KEY_ROOT).boundary;
    expect(avatars).not.toBe(AVATAR_KEY_ROOT);
    expect("avatars-archive/user-1/segment-1/64.webp".startsWith(avatars)).toBe(false);

    const covers = keySetScope(coverOwnerPrefix("novel-1")).boundary;
    expect("covers/novel-10/segment-1/480.webp".startsWith(covers)).toBe(false);
    expect("covers/novel-1/segment-1/480.webp".startsWith(covers)).toBe(true);
  });
});

describe("the owner of a stored object", () => {
  it("reads every kind back out of its key", () => {
    expect(ownerOfObjectKey("covers/novel-1/segment-1/640.webp")).toEqual({
      kind: "cover",
      novelId: "novel-1",
      segment: "segment-1",
    });
    expect(ownerOfObjectKey("avatars/user-1/segment-1/original")).toEqual({
      kind: "avatar",
      userId: "user-1",
      segment: "segment-1",
    });
    expect(ownerOfObjectKey("exports/novel-1/abc123.epub")).toEqual({
      kind: "export",
      novelId: "novel-1",
    });
    expect(ownerOfObjectKey("epub-uploads/upload-1")).toEqual({
      kind: "epub-upload",
      uploadId: "upload-1",
    });
  });

  it("reads nothing into a key that is only close to a real one", () => {
    for (const key of [
      "",
      "covers",
      "covers/novel-1",
      "covers/novel-1/segment-1",
      "covers//segment-1/640.webp",
      "covers/novel-1//640.webp",
      "covers/novel-1/segment-1/640.webp/extra",
      "avatars",
      "avatars/user-1",
      "avatars/user-1/segment-1",
      "exports/novel-1",
      // A file name the export builder never appends: the format is part of the key.
      "exports/novel-1/abc123",
      "exports/novel-1/abc123.json",
      "exports/novel-1/abc123.epub/extra",
      "epub-uploads",
      "epub-uploads/upload-1/extra",
      "covers-archive/novel-1/segment-1/640.webp",
      "notes.txt",
    ]) {
      expect(ownerOfObjectKey(key)).toBeNull();
    }
  });

  it("names the set an owner's objects live in, addressed as a prefix delete takes it", () => {
    for (const [key, set] of [
      ["covers/novel-1/segment-1/640.webp", "covers/novel-1/segment-1"],
      ["avatars/user-1/photo/original", "avatars/user-1/photo"],
      ["exports/novel-1/abc123.epub", "exports/novel-1"],
      ["epub-uploads/upload-1", "epub-uploads/upload-1"],
    ] as const) {
      const owner = ownerOfObjectKey(key);
      expect(owner === null ? null : setOfOwner(owner)).toBe(set);
      // A set a caller can act on, and one that holds the key it was read from: the audit
      // attributes an object through this and a sweep removes it through this, so a set that
      // the vocabulary would refuse, or that sat beside the key instead of over it, would be
      // an object attributed to an owner that nothing can remove.
      expect(isObjectKeyPrefix(set)).toBe(true);
      // The key is in the set it was read from: inside its boundary, or the set itself, which
      // is what a staged archive is — one object that is its own whole set.
      const scope = keySetScope(derivedPrefix(set));
      expect(key === scope.name || key.startsWith(scope.boundary)).toBe(true);
    }
  });

  it("gives every kind exactly one bucket", () => {
    expect([
      ownerBucket("cover"),
      ownerBucket("avatar"),
      ownerBucket("export"),
      ownerBucket("epub-upload"),
    ]).toEqual(["public", "public", "private", "private"]);
  });
});

describe("owner prefixes", () => {
  it("addresses one novel's covers and cached exports as sets, not boundaries", () => {
    expect(coverOwnerPrefix("novel-1")).toBe("covers/novel-1");
    expect(exportKeyPrefix("novel-1")).toBe("exports/novel-1");
    // The separator belongs to the adapter, so a caller never spells one.
    expect(coverOwnerPrefix("novel-1").endsWith("/")).toBe(false);
    expect(exportKeyPrefix("novel-1").endsWith("/")).toBe(false);
  });
});

/**
 * The layout is one thing, so the modules that address a bucket read it in one place.
 *
 * A key spelled anywhere else is how the layouts drift: `covers/<id>/` and
 * `covers/<id>` used to be written by hand at different call sites, so a listing and a
 * delete of the same set disagreed about where it ended. `keys.ts` owns the layout and
 * the adapters own the boundary, which leaves callers naming the set they mean.
 */
const KEY_DERIVING_ENTRY_POINTS = [
  "src/lib/account/purge.server.ts",
  "src/lib/backup.service.ts",
  "src/lib/content/novel/cover-image.server.ts",
  "src/lib/content/novel/cover-storage.server.ts",
  "src/lib/epub/functions.ts",
  "src/lib/export/stream.ts",
  "src/lib/profile/avatar-image.server.ts",
  "src/lib/profile/avatar.server.ts",
  "src/routes/api/avatars/$.ts",
  "src/routes/api/covers/$.ts",
  "scripts/avatar-sweep.ts",
  "scripts/bucket-footprint.ts",
  "scripts/storage-audit.ts",
] as const;

/** The port itself: the one place the layout and the boundary are written down. */
const STORAGE_PORT = [
  "src/lib/storage/index.server.ts",
  "src/lib/storage/keys.ts",
  "src/lib/storage/local.server.ts",
  "src/lib/storage/port.ts",
  "src/lib/storage/r2.server.ts",
  "src/lib/storage/types.ts",
];

/** The adapters a bucket can be built on today; a third one is added here. */

/** The modules that define, build and select the contract, rather than implement it. */
const PORT_CONTRACT_MODULES = [
  "src/lib/storage/index.server.ts",
  "src/lib/storage/port.ts",
  "src/lib/storage/types.ts",
];

/**
 * Every module that implements the adapter contract, found in the tree rather than listed,
 * so a third adapter is covered by the rules below on the day it appears: the assertion just
 * after them names the set, which is what makes a new adapter a failing test instead of a
 * silently unscoped one.
 */
function storageAdapters(): string[] {
  return productionSources()
    .filter((path) => /ObjectStorageBackend/.test(readSource(path)))
    .filter((path) => !PORT_CONTRACT_MODULES.includes(path));
}

/** A bucket key spelled out: a key root standing at the start of a segment. */
const SPELLS_A_KEY = /(?<![\w/-])(?:covers|avatars|exports|epub-uploads)\//;
/** A key root joined to a segment by hand, which only `keys.ts` may do. */
const JOINS_A_KEY_ROOT = /\$\{(?:COVER|AVATAR|EXPORT|EPUB_UPLOAD)_KEY_ROOT\}\//;

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readSource(path: string): string {
  return readFileSync(join(workspaceRoot, path), "utf8");
}

/** Every source that ships, with tests and the generated route tree left out. */
function productionSources(): string[] {
  return ["src", "scripts"].flatMap((root) =>
    readdirSync(join(workspaceRoot, root), { recursive: true, encoding: "utf8" })
      .map((entry) => `${root}/${entry.replaceAll("\\", "/")}`)
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      .filter((path) => !path.endsWith("routeTree.gen.ts")),
  );
}

/**
 * Drops comments before looking for a key, so prose that quotes the layout — a doc
 * comment saying where covers live, or a route path like `/api/covers/$` — is not
 * mistaken for code that builds one. Block comments go first, then indented `//` and
 * `*` continuation lines; a trailing `// ...` is not stripped, which is why the
 * sources below are read as they are written.
 */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*(?:\/\/|\*).*$/gm, "");
}

describe("the modules that address a bucket", () => {
  it.each(KEY_DERIVING_ENTRY_POINTS)("%s takes its keys from the one module", (path) => {
    expect(readSource(path)).toContain('from "@/lib/storage/keys"');
  });

  it("leaves no key spelled by hand outside the port", () => {
    const offenders = productionSources()
      .filter((path) => !STORAGE_PORT.includes(path))
      .map((path) => ({ path, code: withoutComments(readSource(path)) }))
      .filter(({ code }) => SPELLS_A_KEY.test(code) || JOINS_A_KEY_ROOT.test(code))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("builds its storage at one selection point", () => {
    const builders = productionSources()
      .filter((path) => !STORAGE_PORT.includes(path))
      .filter((path) => /create(?:Local|R2)ObjectStorage\(/.test(readSource(path)));

    expect(builders).toEqual([]);
  });

  it.each(["src/lib/storage/keys.ts", "src/lib/storage/port.ts"])(
    "%s states no key of its own, since it owns the shapes instead",
    (path) => {
      // The vocabulary and the port describe the layout, so they name roots and shapes
      // rather than a key: a literal one here would be a second layout.
      expect(readSource(path)).not.toMatch(/"(?:covers|avatars|exports|epub-uploads)\//);
    },
  );

  it("knows every adapter that implements the backend contract", () => {
    expect(storageAdapters()).toEqual([
      "src/lib/storage/local.server.ts",
      "src/lib/storage/r2.server.ts",
    ]);
  });

  it("leaves no adapter able to interpret a prefix", () => {
    // A scope arrives resolved, so an adapter that names a set boundary would be a second
    // reading of it — the drift this layer removes: one adapter's `avatars` would list
    // `avatars-archive/...` while the other's did not.
    expect(
      storageAdapters().filter((path) =>
        /(?:keySet|KeySet)(?:Name|Prefix|Scope)\(/.test(withoutComments(readSource(path))),
      ),
    ).toEqual([]);
  });

  it("leaves the one reading of a prefix to the port", () => {
    const scoping = productionSources()
      .filter((path) => /(?<![\w.])keySetScope\(/.test(withoutComments(readSource(path))))
      .filter((path) => path !== "src/lib/storage/keys.ts");

    expect(scoping).toEqual(["src/lib/storage/port.ts"]);
  });

  it("leaves no module able to cast a string into a key", () => {
    // The brand is the compile-time half of the rule, and a cast is its only hole: a module that
    // asserts one is a module that can address a bucket with a string the vocabulary never derived.
    // `keys.ts` is the exception because it is where a derived value is minted — from a shape it
    // built, or from a value its own predicate has just read back. Tests may cast, deliberately:
    // that is how a fixture stands in for a listing or a request.
    const casts = productionSources()
      .filter((path) => path !== "src/lib/storage/keys.ts")
      .filter((path) => /as (?:ObjectKey|KeySetPrefix)\b/.test(withoutComments(readSource(path))));

    expect(casts).toEqual([]);
  });
});

describe("exportRevision", () => {
  const base = {
    format: "txt" as const,
    novelTitle: "Novel",
    novelAuthor: "Author",
    targetLang: "en",
    chapterCount: 3,
    maxChapterUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    maxTranslationGeneration: 2,
  };

  it("is stable for identical export content", () => {
    expect(exportRevision(base)).toBe(exportRevision({ ...base }));
  });

  it.each([
    ["novelTitle", { novelTitle: "Renamed" }],
    ["novelAuthor", { novelAuthor: null }],
    ["targetLang", { targetLang: "th" }],
    ["chapterCount", { chapterCount: 4 }],
    ["maxChapterUpdatedAt", { maxChapterUpdatedAt: new Date("2026-02-01T00:00:00.000Z") }],
    ["maxTranslationGeneration", { maxTranslationGeneration: 3 }],
  ] as const)("changes when %s changes", (_field, patch) => {
    expect(exportRevision({ ...base, ...patch })).not.toBe(exportRevision(base));
  });

  it("separates formats so a TXT revision cannot serve an EPUB request", () => {
    expect(exportRevision({ ...base, format: "epub" })).not.toBe(exportRevision(base));
  });

  it("embeds the format-version constant", () => {
    expect(EXPORT_FORMAT_VERSION).toBeGreaterThanOrEqual(1);
  });
});
