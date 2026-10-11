import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    api: {
      async put(key: string, bytes: Uint8Array, options: { contentType: string }) {
        objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.contentType });
      },
      async deletePrefix(prefix: string) {
        for (const key of objects.keys()) if (key.startsWith(prefix)) objects.delete(key);
      },
      publicUrl(key: string) {
        return `https://cdn.example.test/${key}`;
      },
    },
  };
});

vi.mock("@/lib/storage/index.server", () => ({
  getPublicStorage: () => storageMock.api,
  getStorage: () => ({ public: storageMock.api }),
  getPrivateStorage: () => storageMock.api,
  isLocalStorage: () => false,
  resetStorageCache: () => {},
}));

const imageMock = vi.hoisted(() => ({
  resizeCalls: [] as number[],
  flattenCalls: 0,
}));

vi.mock("./avatar-image.server", () => ({
  resizeAvatar: async (buffer: Uint8Array, width: number) => {
    imageMock.resizeCalls.push(width);
    return buffer;
  },
  flattenToPng: async () => {
    imageMock.flattenCalls++;
    return PNG_BYTES();
  },
}));

const networkMock = vi.hoisted(() => ({
  calls: [] as string[],
  handler: undefined as undefined | ((url: string) => Promise<unknown>),
}));

vi.mock("@/lib/scrape/network-policy.server", () => ({
  fetchFromPublicHost: (url: string) => {
    networkMock.calls.push(url);
    if (!networkMock.handler) throw new Error("no response configured");
    return networkMock.handler(url);
  },
}));

function PNG_BYTES(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const GIF_BYTES = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function response(
  bytes: Uint8Array | null,
  {
    status = 200,
    contentType = "image/png",
    contentLength,
  }: {
    status?: number;
    contentType?: string;
    contentLength?: string;
  } = {},
) {
  const state = { bodyRead: false };
  return {
    state,
    status,
    headers: new Headers({
      "content-type": contentType,
      ...(contentLength ? { "content-length": contentLength } : {}),
    }),
    async arrayBuffer() {
      state.bodyRead = true;
      return bytes
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : new ArrayBuffer(0);
    },
  };
}

const { adoptProviderImageForUser, isProviderAvatarUrl, mirrorProviderAvatar } =
  await import("./social-avatar.server");

beforeEach(() => {
  storageMock.objects.clear();
  networkMock.calls = [];
  networkMock.handler = undefined;
  imageMock.resizeCalls = [];
  imageMock.flattenCalls = 0;
});

describe("isProviderAvatarUrl", () => {
  it.each([
    "https://lh3.googleusercontent.com/a/abc=s96-c",
    "https://lh6.googleusercontent.com/a/def",
    "https://cdn.discordapp.com/avatars/1/abc.png",
    "https://cdn.discordapp.com/embed/avatars/0.png",
  ])("accepts a provider CDN address (%s)", (url) => {
    expect(isProviderAvatarUrl(url)).toBe(true);
  });

  it.each([
    ["a non-provider host", "https://evil.example.test/me.png"],
    ["a look-alike host", "https://cdn.discordapp.com.evil.example.test/me.png"],
    ["a suffixed look-alike", "https://notgoogleusercontent.com/me.png"],
    ["plain http", "http://cdn.discordapp.com/avatars/1/a.png"],
    ["a data url", "data:image/png;base64,AAAA"],
    ["a local address", "https://127.0.0.1/avatar.png"],
    ["a bare string", "googleusercontent.com/a/abc"],
  ])("refuses %s", (_case, url) => {
    expect(isProviderAvatarUrl(url)).toBe(false);
  });

  it("treats a missing image as no provider photo", () => {
    expect(isProviderAvatarUrl(null)).toBe(false);
    expect(isProviderAvatarUrl(undefined)).toBe(false);
    expect(isProviderAvatarUrl("")).toBe(false);
  });
});

describe("adoptProviderImageForUser", () => {
  it("stores the copy and points the row at it", async () => {
    networkMock.handler = async () => response(PNG_BYTES(), { contentType: "image/png" });
    const save = vi.fn(async (_userId: string, _imageKey: string | null) => {});

    await adoptProviderImageForUser(
      { id: "user-1", image: "https://lh3.googleusercontent.com/a/x" },
      save,
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe("user-1");
    expect(save.mock.calls[0][1]).toMatch(/^avatars\/user-1\/[A-Za-z0-9_-]{16}$/);
  });

  it("clears an address that could not be adopted", async () => {
    networkMock.handler = async () => response(null, { status: 404, contentType: "text/html" });
    const save = vi.fn(async () => {});

    await adoptProviderImageForUser(
      { id: "user-1", image: "https://cdn.discordapp.com/avatars/1/gone.png" },
      save,
    );

    // A provider URL left in the column would never resolve, and nothing could clean it.
    expect(save).toHaveBeenCalledWith("user-1", null);
  });

  it("leaves an email sign-up alone", async () => {
    const save = vi.fn(async () => {});

    await adoptProviderImageForUser({ id: "user-1", image: null }, save);
    await adoptProviderImageForUser({ id: "user-2" }, save);
    await adoptProviderImageForUser({ id: "user-3", image: "avatars/user-3/segment-1" }, save);

    expect(save).not.toHaveBeenCalled();
    expect(networkMock.calls).toEqual([]);
  });
});

describe("mirrorProviderAvatar", () => {
  it("stores the provider photo as an avatar set of our own", async () => {
    networkMock.handler = async () => response(PNG_BYTES(), { contentType: "image/png" });

    const prefix = await mirrorProviderAvatar("user-1", "https://lh3.googleusercontent.com/a/x");

    expect(prefix).toMatch(/^avatars\/user-1\/[A-Za-z0-9_-]{16}$/);
    expect([...storageMock.objects.keys()].toSorted()).toEqual([
      `${prefix}/128.webp`,
      `${prefix}/256.webp`,
      `${prefix}/64.webp`,
      `${prefix}/original`,
    ]);
    expect(storageMock.objects.get(`${prefix}/original`)?.contentType).toBe("image/png");
    expect(imageMock.resizeCalls.toSorted((a, b) => a - b)).toEqual([64, 128, 256]);
  });

  it("does not touch the network for an address it will not fetch", async () => {
    const prefix = await mirrorProviderAvatar("user-1", "https://evil.example.test/me.png");

    expect(prefix).toBeNull();
    expect(networkMock.calls).toEqual([]);
    expect(storageMock.objects.size).toBe(0);
  });

  it("refuses a redirect instead of following it", async () => {
    networkMock.handler = async () => response(null, { status: 302, contentType: "text/html" });

    expect(await mirrorProviderAvatar("user-1", "https://cdn.discordapp.com/a.png")).toBeNull();
    expect(storageMock.objects.size).toBe(0);
  });

  it("refuses bytes that do not match the declared type", async () => {
    // The provider says PNG, the bytes are a JPEG: exactly the upload rule.
    networkMock.handler = async () => response(JPEG_BYTES, { contentType: "image/png" });

    expect(await mirrorProviderAvatar("user-1", "https://cdn.discordapp.com/a.png")).toBeNull();
    expect(storageMock.objects.size).toBe(0);
  });

  it("refuses a declared type outside the avatar vocabulary", async () => {
    networkMock.handler = async () =>
      response(new TextEncoder().encode("<html>nope</html>"), { contentType: "text/html" });

    expect(await mirrorProviderAvatar("user-1", "https://cdn.discordapp.com/a.png")).toBeNull();
    expect(storageMock.objects.size).toBe(0);
  });

  it("flattens an animated GIF avatar to a still PNG", async () => {
    networkMock.handler = async () => response(GIF_BYTES, { contentType: "image/gif" });

    const prefix = await mirrorProviderAvatar(
      "user-1",
      "https://cdn.discordapp.com/avatars/1/a_x.gif",
    );

    expect(imageMock.flattenCalls).toBe(1);
    expect(storageMock.objects.get(`${prefix}/original`)?.contentType).toBe("image/png");
  });

  it("accepts an already-stored webp variant", async () => {
    networkMock.handler = async () => response(WEBP_BYTES, { contentType: "image/webp" });

    const prefix = await mirrorProviderAvatar(
      "user-1",
      "https://cdn.discordapp.com/avatars/1/a.webp",
    );

    expect(prefix).not.toBeNull();
  });

  it("rejects an oversized photo without reading the body", async () => {
    const big = response(PNG_BYTES(), {
      contentType: "image/png",
      contentLength: String(9 * 1024 * 1024),
    });
    networkMock.handler = async () => big;

    expect(await mirrorProviderAvatar("user-1", "https://cdn.discordapp.com/a.png")).toBeNull();
    expect(big.state.bodyRead).toBe(false);
    expect(storageMock.objects.size).toBe(0);
  });

  it("returns null rather than throwing when the fetch itself fails", async () => {
    networkMock.handler = async () => {
      throw new Error("Host resolves to a non-public address");
    };

    expect(await mirrorProviderAvatar("user-1", "https://cdn.discordapp.com/a.png")).toBeNull();
  });
});
