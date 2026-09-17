import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
import {
  isPrivateIp,
  normalizeIpAddress,
  resolveHostAddresses,
  resolvePublicHost,
} from "./network-policy.server";

beforeEach(() => {
  lookup.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("numeric address policy", () => {
  it.each([
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.9",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.1.1",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "64:ff9b::808:808",
    "2001::1",
    "2001:2::1",
    "2001:10::1",
    "2001:20::1",
    "2001:db8::1",
    "2002::1",
    "3fff::1",
    "fe80::1%eth0",
    "not-an-ip",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:a00:1",
  ])("rejects non-public %s", (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "2001:4860:4860::8888",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
    "0:0:0:0:0:ffff:808:808",
  ])("accepts public %s", (address) => {
    expect(isPrivateIp(address)).toBe(false);
  });
  it("canonicalizes expanded, bracketed and mapped peers", () => {
    expect(normalizeIpAddress(" [2001:4860:0000:0000:0000:0000:0000:8888] ")).toEqual({
      address: "2001:4860::8888",
      family: 6,
    });
    expect(normalizeIpAddress("::ffff:0808:0808")).toEqual({ address: "8.8.8.8", family: 4 });
    expect(normalizeIpAddress("[fe80::1%eth0]")).toBeNull();
  });
});

describe("bounded resolution", () => {
  it("validates every answer and deduplicates canonical addresses", async () => {
    lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "::ffff:808:808", family: 6 },
    ]);
    expect(await resolvePublicHost("provider.example")).toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(lookup).toHaveBeenCalledWith("provider.example", { all: true, verbatim: true });
    lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(resolvePublicHost("provider.example")).rejects.toMatchObject({
      code: "NON_PUBLIC",
    });
  });
  it("rejects empty DNS answers", async () => {
    lookup.mockResolvedValue([]);
    await expect(resolveHostAddresses("provider.example")).rejects.toMatchObject({
      code: "DNS_FAILED",
    });
  });
  it("rejects invalid DNS answers", async () => {
    for (const answers of [
      [{ address: "bogus", family: 4 }],
      [{ address: "8.8.8.8", family: 6 }],
      [{ address: "fe80::1%eth0", family: 6 }],
    ] as const) {
      lookup.mockResolvedValue([...answers]);
      await expect(resolveHostAddresses("provider.example")).rejects.toMatchObject({
        code: "DNS_FAILED",
      });
    }
  });
  it("does not resolve literals and times out without accepting late answers", async () => {
    expect(await resolveHostAddresses("[::ffff:808:808]")).toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(lookup).not.toHaveBeenCalled();
    vi.useFakeTimers();
    let resolveLate!: (answers: { address: string; family: number }[]) => void;
    lookup.mockReturnValue(
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
    );
    const result = resolveHostAddresses("provider.example");
    const rejected = expect(result).rejects.toMatchObject({
      code: "DNS_TIMEOUT",
      message: "Hostname lookup timed out",
    });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    resolveLate([{ address: "8.8.8.8", family: 4 }]);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not expose OS diagnostics", async () => {
    lookup.mockRejectedValue(new Error("secret host details"));
    await expect(resolveHostAddresses("provider.example")).rejects.toMatchObject({
      code: "DNS_FAILED",
      message: "Hostname could not be resolved",
    });
  });
});
