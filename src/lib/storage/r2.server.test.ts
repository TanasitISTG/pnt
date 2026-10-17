import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AVATAR_KEY_ROOT,
  avatarOriginalKey,
  avatarPrefix,
  coverObjectKey,
  coverPrefix,
  coverVariantKey,
  epubUploadKey,
  keySetScope,
} from "./keys";
import { createR2ObjectStorage, StorageRequestError } from "./r2.server";

const config = {
  accountId: "account-1",
  accessKeyId: "pnt-access-key",
  secretAccessKey: "secret-key",
  bucket: "pnt-bucket",
  publicBaseUrl: "https://cdn.example.test",
} as const;

// The adapter takes keys the vocabulary derives, so every case below asks a builder for the key it
// means; what travels over the wire is then the builder's path, which is what the URLs assert.
const COVER_SET = coverPrefix("novel-1", "segment");
const COVER_KEY = coverVariantKey(COVER_SET, 480);
const UPLOAD_KEY = epubUploadKey("upload-1");
const ABSENT_KEY = avatarOriginalKey(avatarPrefix("user-missing", "photo"));

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `s3mini` signs each request and then calls the global `fetch` with `(url, init)`, so
 * these tests capture what would actually go over the wire. Every case is asserted
 * through this stub, which is also what proves the adapter never takes `s3mini`'s
 * Bun-only `Bun.S3Client` path on a Bun runtime.
 */
function stubFetch(handler: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    return handler(request);
  });
  return requests;
}

function xml(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "application/xml" } });
}

const SIGV4_AUTHORIZATION =
  /^AWS4-HMAC-SHA256 Credential=pnt-access-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/;

describe("R2 object storage", () => {
  it("writes objects with the declared media type and SigV4 headers", async () => {
    const requests = stubFetch(() => new Response(null, { status: 200 }));
    const storage = createR2ObjectStorage(config);

    await storage.put(COVER_KEY, Uint8Array.from([1, 2, 3]), {
      contentType: "image/webp",
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(
      "https://account-1.r2.cloudflarestorage.com/pnt-bucket/covers/novel-1/segment/480.webp",
    );
    expect(request.headers.get("content-type")).toBe("image/webp");
    expect(request.headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");
    expect(request.headers.get("authorization")).toMatch(SIGV4_AUTHORIZATION);
    // Cover caching is a rule on the public CDN origin, not a per-object header.
    expect(request.headers.get("cache-control")).toBeNull();
  });

  it("percent-encodes each key segment without breaking separators", async () => {
    const requests = stubFetch(() => new Response(null, { status: 200 }));
    const storage = createR2ObjectStorage(config);

    const key = coverObjectKey(coverPrefix("novel 1", "segment"), "key+1");
    await storage.put(key, Uint8Array.from([1]), {
      contentType: "image/webp",
    });

    const [request] = requests;
    expect(request.url).toContain("/pnt-bucket/covers/novel%201/segment/key%2B1");
  });

  it("surfaces a refused write as a storage error with its status", async () => {
    stubFetch(() => xml("<Error><Code>AccessDenied</Code></Error>", 403));
    const storage = createR2ObjectStorage(config);

    await expect(
      storage.put(COVER_KEY, Uint8Array.from([1]), {
        contentType: "image/webp",
      }),
    ).rejects.toBeInstanceOf(StorageRequestError);
    await expect(
      storage.put(COVER_KEY, Uint8Array.from([1]), {
        contentType: "image/webp",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reads bytes with their stored media type", async () => {
    stubFetch(
      () =>
        new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/webp" },
        }),
    );
    const storage = createR2ObjectStorage(config);

    const object = await storage.get(COVER_KEY);
    expect(object?.contentType).toBe("image/webp");
    expect(Buffer.from(object?.bytes ?? [])).toEqual(Buffer.from([1, 2, 3]));
  });

  it("returns null for a missing object instead of throwing", async () => {
    const requests = stubFetch(() => new Response(null, { status: 404 }));
    const storage = createR2ObjectStorage(config);

    await expect(storage.get(ABSENT_KEY)).resolves.toBeNull();
    // `getContentLength` rethrows the S3 failure as a plain Error with a `cause`, so
    // this also covers the adapter reading the status back out of that chain.
    await expect(storage.head(ABSENT_KEY)).resolves.toBeNull();
    expect(requests.map((request) => request.method)).toEqual(["GET", "HEAD"]);
  });

  it("reports metadata without downloading the object", async () => {
    const requests = stubFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "4096", "content-type": "application/epub+zip" },
        }),
    );
    const storage = createR2ObjectStorage(config);

    await expect(storage.head(UPLOAD_KEY)).resolves.toEqual({ size: 4096 });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("HEAD");
  });

  it("deletes a single object", async () => {
    const requests = stubFetch(() => new Response(null, { status: 204 }));
    const storage = createR2ObjectStorage(config);

    await storage.delete(UPLOAD_KEY);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("DELETE");
    expect(requests[0].url).toBe(
      "https://account-1.r2.cloudflarestorage.com/pnt-bucket/epub-uploads/upload-1",
    );
  });

  it("removes every object in one set with a single batched delete", async () => {
    const listed = `<ListBucketResult>
      <Contents><Key>covers/n/seg/320.webp</Key></Contents>
      <Contents><Key>covers/n/seg/640.webp</Key></Contents>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>`;
    const requests = stubFetch((request) => {
      if (request.method === "GET") return xml(listed);
      return xml(
        `<DeleteResult>
          <Deleted><Key>covers/n/seg/320.webp</Key></Deleted>
          <Deleted><Key>covers/n/seg/640.webp</Key></Deleted>
        </DeleteResult>`,
      );
    });
    const storage = createR2ObjectStorage(config);

    await storage.removeSet(keySetScope(coverPrefix("n", "seg")));

    expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
    const [list, remove] = requests;
    expect(list.url).toContain("list-type=2");
    expect(list.url).toContain("max-keys=1000");
    // The boundary the port resolved, so the delete cannot reach `covers/n/segment-2/...`.
    expect(list.url).toContain("prefix=covers%2Fn%2Fseg%2F");
    expect(remove.url).toContain("?delete=");
    // R2 gets the checksum header S3 requires for a batch delete.
    expect(remove.headers.get("x-amz-checksum-sha256")).toMatch(/^[A-Za-z0-9+/=]+$/);
    const body = await remove.text();
    expect(body).toContain("<Key>covers/n/seg/320.webp</Key>");
    expect(body).toContain("<Key>covers/n/seg/640.webp</Key>");
  });

  it("lists every key in a set for callers that reconcile the bucket", async () => {
    const listed = `<ListBucketResult>
      <Contents><Key>avatars/user-1/segment/original</Key></Contents>
      <Contents><Key>avatars/user-1/segment/64.webp</Key></Contents>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>`;
    const requests = stubFetch(() => xml(listed));
    const storage = createR2ObjectStorage(config);

    await expect(storage.listSet(keySetScope(AVATAR_KEY_ROOT))).resolves.toEqual([
      "avatars/user-1/segment/original",
      "avatars/user-1/segment/64.webp",
    ]);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
    expect(requests[0].url).toContain("list-type=2");
    // A raw `prefix=avatars` would also return `avatars-archive/...`; the boundary the port
    // resolved keeps it to the set, so a caller never spells a separator R2 would match.
    expect(requests[0].url).toContain("prefix=avatars%2F");
  });

  it("reports when each object was written, so a sweep can apply a grace period", async () => {
    const listed = `<ListBucketResult>
      <Contents>
        <Key>covers/n/seg/320.webp</Key>
        <LastModified>2026-01-02T03:04:05.000Z</LastModified>
      </Contents>
      <IsTruncated>false</IsTruncated>
    </ListBucketResult>`;
    const requests = stubFetch(() => xml(listed));
    const storage = createR2ObjectStorage(config);

    await expect(storage.listObjects(keySetScope(coverPrefix("n", "seg")))).resolves.toEqual([
      { key: "covers/n/seg/320.webp", lastModified: new Date("2026-01-02T03:04:05.000Z") },
    ]);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("follows continuation tokens to the end of a listing", async () => {
    let page = 0;
    const requests = stubFetch(() => {
      page += 1;
      return page === 1
        ? xml(`<ListBucketResult>
            <Contents><Key>avatars/user-1/segment/original</Key></Contents>
            <IsTruncated>true</IsTruncated>
            <NextContinuationToken>token-1</NextContinuationToken>
          </ListBucketResult>`)
        : xml(`<ListBucketResult>
            <Contents><Key>avatars/user-1/segment/64.webp</Key></Contents>
            <IsTruncated>false</IsTruncated>
          </ListBucketResult>`);
    });
    const storage = createR2ObjectStorage(config);

    await expect(storage.listSet(keySetScope(AVATAR_KEY_ROOT))).resolves.toEqual([
      "avatars/user-1/segment/original",
      "avatars/user-1/segment/64.webp",
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain("continuation-token=token-1");
  });

  it("reports an absent bucket as null rather than an empty listing", async () => {
    const requests = stubFetch(() => xml("<Error><Code>NoSuchBucket</Code></Error>", 404));
    const storage = createR2ObjectStorage(config);

    // Null is the signal that nothing was inspected; an empty array would claim the
    // bucket was read and found empty.
    await expect(storage.listSet(keySetScope(AVATAR_KEY_ROOT))).resolves.toBeNull();
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("treats an absent bucket as nothing to delete", async () => {
    const requests = stubFetch(() => xml("<Error><Code>NoSuchBucket</Code></Error>", 404));
    const storage = createR2ObjectStorage(config);

    await expect(storage.removeSet(keySetScope(coverPrefix("n", "seg")))).resolves.toBeUndefined();
    // Listing tolerates 404 and reports it as null; no delete request is attempted.
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("presigns a bounded write capability for exactly one key", async () => {
    const requests = stubFetch(() => new Response(null, { status: 200 }));
    const storage = createR2ObjectStorage(config);

    const url = new URL(
      await storage.presignPut(UPLOAD_KEY, {
        contentType: "application/epub+zip",
        expiresIn: 900,
      }),
    );

    // Presigning is local signing: nothing is sent for an unsigned URL to be issued.
    expect(requests).toHaveLength(0);
    expect(url.origin).toBe("https://account-1.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/pnt-bucket/epub-uploads/upload-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    // Only `host` is signed beyond the query, so the URL cannot be replayed elsewhere.
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("only exposes public URLs for the bucket that is served publicly", () => {
    const publicStorage = createR2ObjectStorage(config);
    expect(publicStorage.publicUrl(coverVariantKey(coverPrefix("n", "seg"), 640))).toBe(
      "https://cdn.example.test/covers/n/seg/640.webp",
    );

    const privateStorage = createR2ObjectStorage({ ...config, publicBaseUrl: null });
    expect(privateStorage.publicUrl(UPLOAD_KEY)).toBeNull();
  });
});
