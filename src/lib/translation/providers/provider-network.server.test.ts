import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupFunction, Socket } from "node:net";
import type { buildConnector } from "undici";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetch: vi.fn(),
  build: vi.fn(),
  connect: undefined as unknown,
  agentOptions: undefined as unknown,
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("@/lib/env", () => ({
  env: { LOCAL_PROVIDER_ORIGINS: ["http://localhost:4010"] },
  parseLocalProviderOrigins: JSON.parse,
}));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: { connect: unknown; maxResponseSize: number }) {
      mocks.connect = options.connect;
      mocks.agentOptions = options;
    }
  },
  buildConnector: mocks.build,
  fetch: mocks.fetch,
}));
import {
  assertProviderBaseUrl,
  createProviderFetch,
  normalizeProviderBaseUrl,
} from "./provider-network.server";

const connectOptions = {
  hostname: "provider.example",
  protocol: "https:",
  port: "443",
  servername: "provider.example",
};
function connect(options = connectOptions) {
  const result = Promise.withResolvers<Socket>();
  (mocks.connect as buildConnector.connector)(options, (error, socket) => {
    if (error) result.reject(error);
    else result.resolve(socket);
  });
  return result.promise;
}

beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.fetch.mockReset().mockImplementation(async () => Response.json({ ok: true }));
  mocks.build
    .mockReset()
    .mockImplementation(() => (_options: unknown, callback: buildConnector.Callback) => {
      callback(null, { remoteAddress: "8.8.8.8", destroy: vi.fn() } as unknown as Socket);
    });
});
afterEach(() => vi.useRealTimers());

describe("provider connection policy", () => {
  it("blocks mixed answers before opening a socket", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(connect()).rejects.toMatchObject({ code: "NON_PUBLIC" });
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("pins all/family lookup results without changing hostname or SNI", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
    const opened = vi.fn((_options: unknown, callback: buildConnector.Callback) =>
      callback(null, { remoteAddress: "::ffff:808:808", destroy: vi.fn() } as unknown as Socket),
    );
    mocks.build.mockReturnValue(opened);
    await connect();
    expect(opened.mock.calls[0][0]).toEqual(connectOptions);
    const lookup = mocks.build.mock.calls[0][0].lookup as LookupFunction;
    const callback = vi.fn();
    lookup("provider.example", { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
    lookup("provider.example", { family: 6 }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, "2606:4700::1111", 6);
    lookup("different.example", {}, callback);
    expect(callback.mock.calls.at(-1)?.[0]).toMatchObject({ code: "ORIGIN_MISMATCH" });
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
  it("checks numeric literals and only exempts exact local origins", async () => {
    await expect(
      connect({ hostname: "127.0.0.1", protocol: "https:", port: "443", servername: "" }),
    ).rejects.toMatchObject({ code: "NON_PUBLIC" });
    expect(mocks.lookup).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    mocks.build.mockReturnValue((_options: unknown, callback: buildConnector.Callback) =>
      callback(null, { remoteAddress: "127.0.0.1", destroy: vi.fn() } as unknown as Socket),
    );
    await expect(
      connect({ hostname: "localhost", protocol: "http:", port: "4010", servername: "" }),
    ).resolves.toMatchObject({ remoteAddress: "127.0.0.1" });
    await expect(
      connect({ hostname: "localhost", protocol: "http:", port: "4011", servername: "" }),
    ).rejects.toMatchObject({ code: "HTTPS_REQUIRED" });
  });
  it("destroys mismatched peers and revalidates new connections", async () => {
    const destroy = vi.fn();
    mocks.build.mockReturnValue((_options: unknown, callback: buildConnector.Callback) =>
      callback(null, { remoteAddress: "1.1.1.1", destroy } as unknown as Socket),
    );
    await expect(connect()).rejects.toMatchObject({ code: "PEER_MISMATCH" });
    expect(destroy).toHaveBeenCalledOnce();
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(connect()).rejects.toMatchObject({ code: "NON_PUBLIC" });
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });
  it("settles DNS timeout once and never connects on late resolution", async () => {
    vi.useFakeTimers();
    const dns = Promise.withResolvers<{ address: string; family: number }[]>();
    mocks.lookup.mockReturnValue(dns.promise);
    const rejected = expect(connect()).rejects.toMatchObject({ code: "DNS_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    dns.resolve([{ address: "8.8.8.8", family: 4 }]);
    await Promise.resolve();
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("validates configuration without leaking resolver details", async () => {
    expect(normalizeProviderBaseUrl("", "openai")).toBe("https://api.openai.com/v1");
    expect(() => normalizeProviderBaseUrl("https://user:secret@example.com", "gemini")).toThrow(
      "Provider URL is invalid",
    );
    expect(() =>
      normalizeProviderBaseUrl("https://provider.example/v1?tenant=secret", "openai"),
    ).toThrow("Provider URL is invalid");
    mocks.lookup.mockRejectedValue(new Error("secret DNS details"));
    await expect(
      assertProviderBaseUrl("https://provider.example/base", "gemini"),
    ).rejects.toMatchObject({
      code: "DNS_FAILED",
      message: "Provider hostname could not be resolved",
    });
  });
});

describe("scoped fetch", () => {
  it("bounds all provider response bodies at the shared Undici agent", () => {
    expect(mocks.agentOptions).toMatchObject({
      connect: mocks.connect,
      maxResponseSize: 8 * 1024 * 1024,
    });
  });
  it("also bounds the decoded Fetch body after content decompression", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024));
            controller.enqueue(new Uint8Array(4 * 1024 * 1024));
            controller.enqueue(new Uint8Array(1));
            controller.close();
          },
        }),
        { headers: { "content-encoding": "gzip" } },
      ),
    );

    const response = await createProviderFetch("https://provider.example")(
      "https://provider.example/completion",
    );
    await expect(response.arrayBuffer()).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
      message: "Provider response exceeded the size limit",
    });
  });
  it("rejects cross-origin input before credentials reach transport", async () => {
    await expect(
      createProviderFetch("https://provider.example/base")("https://other.example", {
        headers: { Authorization: "secret" },
      }),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("preserves Request bodies and overrides while fixing redirect/dispatcher", async () => {
    const signal = new AbortController().signal;
    const request = new Request("https://provider.example/base", {
      method: "POST",
      body: "original",
      headers: { "x-test": "one" },
    });
    await createProviderFetch("https://provider.example/base")(request, {
      body: "override",
      signal,
      redirect: "follow",
    });
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe(request.url);
    expect(options).toMatchObject({ method: "POST", body: "override", signal, redirect: "manual" });
    expect(options.dispatcher).toBeDefined();
    await createProviderFetch("https://provider.example/base")(
      new Request(request.url, { method: "POST", body: "streamed" }),
    );
    const forwarded = mocks.fetch.mock.calls[1][1];
    expect(forwarded.duplex).toBe("half");
    expect(await new Response(forwarded.body).text()).toBe("streamed");
  });
  it("cancels even same-origin redirects instead of following them", async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue({
      status: 302,
      headers: new Headers({ Location: "https://provider.example/next" }),
      body: { cancel },
    });
    cancel.mockResolvedValue(undefined);
    await expect(
      createProviderFetch("https://provider.example")("https://provider.example/start"),
    ).rejects.toMatchObject({ code: "REDIRECT_NOT_ALLOWED" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
