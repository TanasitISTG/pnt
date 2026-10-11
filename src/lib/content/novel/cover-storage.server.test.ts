import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    publicUrlBase: "https://cdn.example.test",
    api: {
      getPublicStorage: () => ({
        async put(key: string, bytes: Uint8Array, options: { contentType: string }) {
          objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.contentType });
        },
        async deletePrefix(prefix: string) {
          for (const key of objects.keys()) {
            if (key.startsWith(prefix)) objects.delete(key);
          }
        },
        publicUrl(key: string) {
          // Mirrors the R2 adapter: no configured origin means app-proxied reads.
          return storageMock.publicUrlBase ? `${storageMock.publicUrlBase}/${key}` : null;
        },
      }),
    },
  };
});

vi.mock("@/lib/storage/index.server", () => ({
  getPublicStorage: () => storageMock.api.getPublicStorage(),
  getStorage: () => ({ public: storageMock.api.getPublicStorage() }),
  getPrivateStorage: () => storageMock.api.getPublicStorage(),
  isLocalStorage: () => false,
  resetStorageCache: () => {},
}));

// Image resizing has its own suite; this one is about which objects get written.
vi.mock("@/lib/content/novel/cover-image.server", () => ({
  resizeCover: async (buffer: Uint8Array) => buffer,
}));

const { defaultCoverWidth } = await import("@/lib/storage/keys");
const { deleteCoverSet, resolvePublicCover, writeCoverSet } =
  await import("./cover-storage.server");

const LIVE = new Date(Date.now() - 60_000);
const SCHEDULED = new Date(Date.now() + 60_000);

beforeEach(() => {
  storageMock.objects.clear();
  storageMock.publicUrlBase = "https://cdn.example.test";
});

describe("writeCoverSet", () => {
  it("writes the original plus every variant under a fresh prefix", async () => {
    const prefix = await writeCoverSet("novel-1", Uint8Array.from([1, 2, 3]), "image/png");

    expect(prefix).toMatch(/^covers\/novel-1\/[A-Za-z0-9_-]{16}$/);
    expect([...storageMock.objects.keys()].toSorted()).toEqual([
      `${prefix}/320.webp`,
      `${prefix}/480.webp`,
      `${prefix}/640.webp`,
      `${prefix}/original`,
    ]);
    expect(storageMock.objects.get(`${prefix}/original`)?.contentType).toBe("image/png");
    expect(storageMock.objects.get(`${prefix}/480.webp`)?.contentType).toBe("image/webp");
  });

  it("uses a new prefix per upload so a replaced cover cannot be served stale", async () => {
    const first = await writeCoverSet("novel-1", Uint8Array.from([1]), "image/png");
    const second = await writeCoverSet("novel-1", Uint8Array.from([2]), "image/png");

    expect(first).not.toBe(second);
  });
});

describe("deleteCoverSet", () => {
  it("removes every object of a prefix and ignores absent keys", async () => {
    const prefix = await writeCoverSet("novel-1", Uint8Array.from([1]), "image/png");

    await deleteCoverSet(prefix);
    expect([...storageMock.objects.keys()]).toEqual([]);

    await expect(deleteCoverSet(null)).resolves.toBeUndefined();
    await expect(deleteCoverSet("covers/never-existed")).resolves.toBeUndefined();
  });
});

describe("resolvePublicCover", () => {
  it("returns a CDN URL and src set for a live novel", () => {
    const resolved = resolvePublicCover("covers/novel-1/seg", LIVE);

    expect(resolved?.url).toBe(
      `https://cdn.example.test/covers/novel-1/seg/${defaultCoverWidth()}.webp`,
    );
    expect(resolved?.srcSet?.split(", ")).toEqual([
      "https://cdn.example.test/covers/novel-1/seg/320.webp 320w",
      "https://cdn.example.test/covers/novel-1/seg/480.webp 480w",
      "https://cdn.example.test/covers/novel-1/seg/640.webp 640w",
    ]);
  });

  it.each([
    ["a novel with no cover", null, LIVE],
    ["a draft novel", "covers/novel-1/seg", null],
    ["a scheduled novel", "covers/novel-1/seg", SCHEDULED],
  ] as const)("withholds the public URL for %s", (_case, coverKey, publishedAt) => {
    expect(resolvePublicCover(coverKey, publishedAt)).toBeNull();
  });

  it("withholds the public URL when no public bucket origin is configured", () => {
    storageMock.publicUrlBase = "";
    expect(resolvePublicCover("covers/novel-1/seg", LIVE)).toBeNull();
  });
});
