import "@tanstack/react-start/server-only";

import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { BlockList, isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import type { RequestInit as UndiciRequestInit } from "undici";
import { findSource } from "@/lib/scrape";

export type HostAddress = { address: string; family: 4 | 6 };

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedV4.addSubnet(address, prefix, "ipv4");
const mappedV4 = new BlockList();
mappedV4.addSubnet("::ffff:0:0", 96, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blockedV6.addSubnet(address, prefix, "ipv6");

export function normalizeIpAddress(address: string): HostAddress | null {
  let value = address.trim();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (value.includes("%")) return null;
  const family = isIP(value);
  if (family === 4) return { address: value, family };
  if (family !== 6) return null;
  value = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  if (mappedV4.check(value, "ipv6")) {
    const parts = value.split(":");
    const high = Number.parseInt(parts[parts.length - 2], 16);
    const low = Number.parseInt(parts[parts.length - 1], 16);
    return { address: `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`, family: 4 };
  }
  return { address: value, family: 6 };
}

export function isPrivateIp(address: string): boolean {
  const normalized = normalizeIpAddress(address);
  if (!normalized) return true;
  if (normalized.family === 4) return blockedV4.check(normalized.address, "ipv4");
  return !globalV6.check(normalized.address, "ipv6") || blockedV6.check(normalized.address, "ipv6");
}

export class HostResolutionError extends Error {
  constructor(readonly code: "DNS_TIMEOUT" | "DNS_FAILED" | "NON_PUBLIC") {
    super(
      code === "DNS_TIMEOUT"
        ? "Hostname lookup timed out"
        : code === "NON_PUBLIC"
          ? "Host resolves to a non-public address"
          : "Hostname could not be resolved",
    );
    this.name = "HostResolutionError";
  }
}

export async function resolveHostAddresses(hostname: string): Promise<readonly HostAddress[]> {
  const literal = normalizeIpAddress(hostname);
  if (literal) return [literal];
  // Invalid numeric/zone literals must not be handed to an OS resolver.
  if (
    hostname.includes(":") ||
    hostname.includes("%") ||
    hostname.includes("[") ||
    hostname.includes("]")
  ) {
    throw new HostResolutionError("DNS_FAILED");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answers: LookupAddress[];
  try {
    const lookupPromise = lookup(hostname, { all: true, verbatim: true });
    // The timeout can win the race; consume a late rejection so it stays handled.
    void lookupPromise.catch(() => {});
    answers = await Promise.race([
      lookupPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HostResolutionError("DNS_TIMEOUT")), 5000);
      }),
    ]);
  } catch (error) {
    if (error instanceof HostResolutionError) throw error;
    throw new HostResolutionError("DNS_FAILED");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  const unique = new Map<string, HostAddress>();
  for (const answer of answers) {
    if ((answer.family !== 4 && answer.family !== 6) || isIP(answer.address) !== answer.family) {
      throw new HostResolutionError("DNS_FAILED");
    }
    const normalized = normalizeIpAddress(answer.address);
    if (!normalized) throw new HostResolutionError("DNS_FAILED");
    unique.set(normalized.address, normalized);
  }
  if (!unique.size) throw new HostResolutionError("DNS_FAILED");
  return [...unique.values()];
}

export async function resolvePublicHost(hostname: string): Promise<readonly HostAddress[]> {
  const addresses = await resolveHostAddresses(hostname);
  if (addresses.some(({ address }) => isPrivateIp(address)))
    throw new HostResolutionError("NON_PUBLIC");
  return addresses;
}

export async function assertPublicHost(url: string): Promise<void> {
  findSource(url);
  await resolvePublicHost(new URL(url).hostname);
}

const publicHostConnector: buildConnector.connector = (options, callback) => {
  let settled = false;
  const finish: buildConnector.Callback = (...args) => {
    if (settled) {
      if (args[1]) args[1].destroy();
      return;
    }
    settled = true;
    if (args[0]) callback(args[0], null);
    else callback(null, args[1]);
  };

  void (async () => {
    if (options.socketPath || options.httpSocket || options.protocol !== "https:") {
      throw new HostResolutionError("NON_PUBLIC");
    }

    const hostname = options.hostname.replace(/^\[|\]$/g, "");
    const addresses = await resolvePublicHost(hostname);
    const expectedHostname = hostname.toLowerCase();
    const pinnedLookup: LookupFunction = (requestedHostname, lookupOptions, done) => {
      if (requestedHostname.replace(/^\[|\]$/g, "").toLowerCase() !== expectedHostname) {
        done(new HostResolutionError("NON_PUBLIC"), "", 0);
        return;
      }
      if (lookupOptions.all) {
        done(
          null,
          addresses.map((answer) => ({ ...answer })),
        );
        return;
      }
      const answer = addresses.find(
        (item) => !lookupOptions.family || item.family === lookupOptions.family,
      );
      if (!answer) {
        done(new HostResolutionError("DNS_FAILED"), "", 0);
        return;
      }
      done(null, answer.address, answer.family);
    };
    const connect = buildConnector({
      lookup: pinnedLookup,
      autoSelectFamily: true,
      timeout: 10_000,
    });
    connect(options, (error, socket) => {
      if (error) {
        finish(error, null);
        return;
      }
      const remote = socket.remoteAddress && normalizeIpAddress(socket.remoteAddress);
      if (!remote || !addresses.some((answer) => answer.address === remote.address)) {
        socket.destroy();
        finish(new HostResolutionError("NON_PUBLIC"), null);
        return;
      }
      finish(null, socket);
    });
  })().catch((error: unknown) =>
    finish(error instanceof Error ? error : new HostResolutionError("DNS_FAILED"), null),
  );
};

const publicHostAgent = new Agent({ connect: publicHostConnector });

export async function fetchFromPublicHost(url: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new HostResolutionError("NON_PUBLIC");
  }
  try {
    const response = await undiciFetch(parsed, {
      ...init,
      dispatcher: publicHostAgent,
      redirect: "manual",
    } as UndiciRequestInit);
    return response as unknown as Response;
  } catch (error) {
    if (error instanceof Error && error.cause instanceof HostResolutionError) {
      throw error.cause;
    }
    throw error;
  }
}
