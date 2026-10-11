import { afterEach, describe, expect, it, vi } from "vitest";

import { createR2ObjectStorage, StorageRequestError } from "./r2.server";

const config = {
  accountId: "account-1",
  accessKeyId: "pnt-access-key",
  secretAccessKey: "secret-key",
  bucket: "pnt-bucket",
  publicBaseUrl: "https://cdn.example.test",
} as const;

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

    await storage.put("covers/novel-1/segment/480.webp", Uint8Array.from([1, 2, 3]), {
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

    await storage.put("covers/novel 1/segment/key+1", Uint8Array.from([1]), {
      contentType: "image/webp",
    });

    const [request] = requests;
    expect(request.url).toContain("/pnt-bucket/covers/novel%201/segment/key%2B1");
  });

  it("surfaces a refused write as a storage error with its status", async () => {
    stubFetch(() => xml("<Error><Code>AccessDenied</Code></Error>", 403));
    const storage = createR2ObjectStorage(config);

    await expect(
      storage.put("covers/novel-1/segment/480.webp", Uint8Array.from([1]), {
        contentType: "image/webp",
      }),
    ).rejects.toBeInstanceOf(StorageRequestError);
    await expect(
      storage.put("covers/novel-1/segment/480.webp", Uint8Array.from([1]), {
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

    const object = await storage.get("covers/novel-1/segment/480.webp");
    expect(object?.contentType).toBe("image/webp");
    expect(Buffer.from(object?.bytes ?? [])).toEqual(Buffer.from([1, 2, 3]));
  });

  it("returns null for a missing object instead of throwing", async () => {
    const requests = stubFetch(() => new Response(null, { status: 404 }));
    const storage = createR2ObjectStorage(config);

    await expect(storage.get("covers/missing")).resolves.toBeNull();
    // `getContentLength` rethrows the S3 failure as a plain Error with a `cause`, so
    // this also covers the adapter reading the status back out of that chain.
    await expect(storage.head("covers/missing")).resolves.toBeNull();
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

    await expect(storage.head("epub-uploads/upload-1")).resolves.toEqual({ size: 4096 });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("HEAD");
  });

  it("deletes a single object", async () => {
    const requests = stubFetch(() => new Response(null, { status: 204 }));
    const storage = createR2ObjectStorage(config);

    await storage.delete("epub-uploads/upload-1");

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("DELETE");
    expect(requests[0].url).toBe(
      "https://account-1.r2.cloudflarestorage.com/pnt-bucket/epub-uploads/upload-1",
    );
  });

  it("removes every object under a prefix with one batched delete", async () => {
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

    await storage.deletePrefix("covers/n/seg");

    expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
    const [list, remove] = requests;
    expect(list.url).toContain("list-type=2");
    expect(list.url).toContain("max-keys=1000");
    expect(list.url).toContain("prefix=covers%2Fn%2Fseg");
    expect(remove.url).toContain("?delete=");
    // R2 gets the checksum header S3 requires for a batch delete.
    expect(remove.headers.get("x-amz-checksum-sha256")).toMatch(/^[A-Za-z0-9+/=]+$/);
    const body = await remove.text();
    expect(body).toContain("<Key>covers/n/seg/320.webp</Key>");
    expect(body).toContain("<Key>covers/n/seg/640.webp</Key>");
  });

  it("treats an absent bucket as nothing to delete", async () => {
    const requests = stubFetch(() => xml("<Error><Code>NoSuchBucket</Code></Error>", 404));
    const storage = createR2ObjectStorage(config);

    await expect(storage.deletePrefix("covers/n/seg")).resolves.toBeUndefined();
    // Listing tolerates 404 and reports it as null; no delete request is attempted.
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("presigns a bounded write capability for exactly one key", async () => {
    const requests = stubFetch(() => new Response(null, { status: 200 }));
    const storage = createR2ObjectStorage(config);

    const url = new URL(
      await storage.presignPut("epub-uploads/upload-1", {
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
    expect(publicStorage.publicUrl("covers/n/seg/640.webp")).toBe(
      "https://cdn.example.test/covers/n/seg/640.webp",
    );

    const privateStorage = createR2ObjectStorage({ ...config, publicBaseUrl: null });
    expect(privateStorage.publicUrl("epub-uploads/upload-1")).toBeNull();
  });
});
