import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupFunction, Socket } from "node:net";
import type { buildConnector } from "undici";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  build: vi.fn(),
  fetch: vi.fn(),
  connect: undefined as unknown,
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({
  Agent: function MockAgent(options: { connect: unknown }) {
    mocks.connect = options.connect;
  },
  buildConnector: mocks.build,
  fetch: mocks.fetch,
}));

import { fetchFromPublicHost } from "./network-policy.server";

const connectOptions = {
  hostname: "www.quanben.io",
  protocol: "https:",
  port: "443",
  servername: "www.quanben.io",
};

function connect() {
  const result = Promise.withResolvers<Socket>();
  (mocks.connect as buildConnector.connector)(connectOptions, (error, socket) => {
    if (error) result.reject(error);
    else result.resolve(socket);
  });
  return result.promise;
}

beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.build
    .mockReset()
    .mockImplementation(() => (_options: unknown, callback: buildConnector.Callback) => {
      callback(null, { remoteAddress: "8.8.8.8", destroy: vi.fn() } as unknown as Socket);
    });
  mocks.fetch.mockReset().mockResolvedValue(Response.json({ ok: true }));
});

describe("direct scrape pinned transport", () => {
  it("pins DNS answers while preserving the original hostname and SNI", async () => {
    const opened = vi.fn((_options: unknown, callback: buildConnector.Callback) => {
      callback(null, { remoteAddress: "8.8.8.8", destroy: vi.fn() } as unknown as Socket);
    });
    mocks.build.mockReturnValue(opened);
    await connect();

    expect(opened.mock.calls[0]?.[0]).toEqual(connectOptions);
    const [connectorOptions] = mocks.build.mock.calls[0];
    expect(connectorOptions).toMatchObject({ lookup: expect.any(Function) });
    const pinnedLookup = connectorOptions.lookup as LookupFunction;
    const callback = vi.fn();
    pinnedLookup("www.quanben.io", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
    expect(mocks.lookup).toHaveBeenCalledWith("www.quanben.io", { all: true, verbatim: true });
  });

  it("rejects a changed private answer on every new connection", async () => {
    await connect();
    mocks.lookup.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);

    await expect(connect()).rejects.toMatchObject({ code: "NON_PUBLIC" });
    expect(mocks.build).toHaveBeenCalledTimes(1);
  });

  it("destroys a socket whose peer is not one of the approved answers", async () => {
    const destroy = vi.fn();
    mocks.build.mockReturnValue((_options: unknown, callback: buildConnector.Callback) => {
      callback(null, { remoteAddress: "1.1.1.1", destroy } as unknown as Socket);
    });

    await expect(connect()).rejects.toMatchObject({ code: "NON_PUBLIC" });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses the pinned dispatcher and forces manual redirect handling", async () => {
    await fetchFromPublicHost("https://www.quanben.io/n/book/1.html", {
      headers: { Accept: "text/html" },
      redirect: "follow",
    });

    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL("https://www.quanben.io/n/book/1.html"),
      expect.objectContaining({
        headers: { Accept: "text/html" },
        redirect: "manual",
        dispatcher: expect.anything(),
      }),
    );
  });
});
