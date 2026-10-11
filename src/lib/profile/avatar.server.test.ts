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
          // Mirrors the filesystem adapter: no configured origin means app-proxied reads.
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

// Pixel work has its own suite; this one is about which objects get written and served.
vi.mock("./avatar-image.server", () => ({
  resizeAvatar: async (buffer: Uint8Array) => buffer,
}));

const { deleteAvatarSet, resolveUserAvatar, writeAvatarSet } = await import("./avatar.server");
const { defaultAvatarWidth } = await import("@/lib/storage/keys");

beforeEach(() => {
  storageMock.objects.clear();
  storageMock.publicUrlBase = "https://cdn.example.test";
});

describe("writeAvatarSet", () => {
  it("writes the original plus every variant under a fresh prefix", async () => {
    const prefix = await writeAvatarSet("user-1", Uint8Array.from([1, 2, 3]), "image/png");

    expect(prefix).toMatch(/^avatars\/user-1\/[A-Za-z0-9_-]{16}$/);
    expect([...storageMock.objects.keys()].toSorted()).toEqual([
      `${prefix}/128.webp`,
      `${prefix}/256.webp`,
      `${prefix}/64.webp`,
      `${prefix}/original`,
    ]);
    expect(storageMock.objects.get(`${prefix}/original`)?.contentType).toBe("image/png");
    expect(storageMock.objects.get(`${prefix}/128.webp`)?.contentType).toBe("image/webp");
  });

  it("uses a new prefix per upload so a replaced photo cannot be served stale", async () => {
    const first = await writeAvatarSet("user-1", Uint8Array.from([1]), "image/png");
    const second = await writeAvatarSet("user-1", Uint8Array.from([2]), "image/png");

    expect(first).not.toBe(second);
  });
});

describe("deleteAvatarSet", () => {
  it("removes every object of a prefix and ignores absent keys", async () => {
    const prefix = await writeAvatarSet("user-1", Uint8Array.from([1]), "image/png");

    await deleteAvatarSet(prefix);
    expect([...storageMock.objects.keys()]).toEqual([]);

    await expect(deleteAvatarSet(null)).resolves.toBeUndefined();
    await expect(deleteAvatarSet(undefined)).resolves.toBeUndefined();
    await expect(deleteAvatarSet("avatars/never-existed")).resolves.toBeUndefined();
  });
});

describe("resolveUserAvatar", () => {
  it("returns a CDN URL and src set for a stored key", () => {
    const resolved = resolveUserAvatar("avatars/user-1/segment-1");

    expect(resolved?.url).toBe(
      `https://cdn.example.test/avatars/user-1/segment-1/${defaultAvatarWidth()}.webp`,
    );
    expect(resolved?.srcSet?.split(", ")).toEqual([
      "https://cdn.example.test/avatars/user-1/segment-1/64.webp 64w",
      "https://cdn.example.test/avatars/user-1/segment-1/128.webp 128w",
      "https://cdn.example.test/avatars/user-1/segment-1/256.webp 256w",
    ]);
  });

  it.each([
    ["a user with no photo", null],
    ["an empty stored value", ""],
    ["a key that is not an avatar prefix", "covers/novel-1/segment-1"],
    ["a key with a missing segment", "avatars/user-1"],
  ] as const)("resolves nothing for %s", (_case, imageKey) => {
    expect(resolveUserAvatar(imageKey)).toBeNull();
  });

  it("falls back to the app route, carrying the segment, when no CDN origin exists", () => {
    storageMock.publicUrlBase = "";
    const resolved = resolveUserAvatar("avatars/user-1/segment-1");

    // The segment in the path is what lets that response be cached immutably.
    expect(resolved?.url).toBe("/api/avatars/user-1/segment-1?w=256");
    expect(resolved?.srcSet).toBe(
      "/api/avatars/user-1/segment-1?w=64 64w, /api/avatars/user-1/segment-1?w=128 128w, /api/avatars/user-1/segment-1?w=256 256w",
    );
  });
});
