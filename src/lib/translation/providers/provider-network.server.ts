import "@tanstack/react-start/server-only";

import type { LookupFunction } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import type { RequestInit as UndiciRequestInit } from "undici";
import { env, parseLocalProviderOrigins as parseOriginList } from "@/lib/env";
import type { ProviderType } from "@/lib/providers/types";
import {
  HostResolutionError,
  isPrivateIp,
  normalizeIpAddress,
  resolveHostAddresses,
} from "@/lib/scrape/network-policy.server";
import { normalizeOpenCodeBaseUrl } from "./provider-compatibility";

export function parseLocalProviderOrigins(raw: string): ReadonlySet<string> {
  return new Set(parseOriginList(raw));
}
const localOrigins: ReadonlySet<string> = new Set(env.LOCAL_PROVIDER_ORIGINS);

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export function assertProviderUrl(url: URL, expectedOrigin?: string): void {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new ProviderRequestError("Provider URL is invalid", "INVALID_URL");
  }
  if (expectedOrigin !== undefined && url.origin !== expectedOrigin) {
    throw new ProviderRequestError("Provider origin is not allowed", "ORIGIN_MISMATCH");
  }
  if (url.protocol !== "https:" && !localOrigins.has(url.origin)) {
    throw new ProviderRequestError("Provider HTTPS is required", "HTTPS_REQUIRED");
  }
}

export function normalizeProviderBaseUrl(value: string, provider: ProviderType): string {
  let url: URL;
  try {
    const base =
      value.trim() ||
      (provider === "openai"
        ? "https://api.openai.com/v1"
        : "https://generativelanguage.googleapis.com");
    url = new URL(provider === "openai" ? normalizeOpenCodeBaseUrl(base) : base);
  } catch {
    throw new ProviderRequestError("Provider URL is invalid", "INVALID_URL");
  }
  assertProviderUrl(url);
  return url.toString().replace(/\/$/, "");
}

async function approvedAddresses(url: URL) {
  try {
    const addresses = await resolveHostAddresses(url.hostname);
    if (!localOrigins.has(url.origin) && addresses.some(({ address }) => isPrivateIp(address))) {
      throw new HostResolutionError("NON_PUBLIC");
    }
    return addresses;
  } catch (error) {
    if (error instanceof HostResolutionError) {
      throw new ProviderRequestError(
        error.code === "DNS_TIMEOUT"
          ? "Provider hostname lookup timed out"
          : error.code === "NON_PUBLIC"
            ? "Provider host resolves to a non-public address"
            : "Provider hostname could not be resolved",
        error.code,
      );
    }
    throw new ProviderRequestError("Provider hostname could not be resolved", "DNS_FAILED");
  }
}

export async function assertProviderBaseUrl(
  value: string,
  provider: ProviderType,
): Promise<string> {
  const baseUrl = normalizeProviderBaseUrl(value, provider);
  await approvedAddresses(new URL(baseUrl));
  return baseUrl;
}

const connector: buildConnector.connector = (options, callback) => {
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
    if (options.socketPath || options.httpSocket) {
      throw new ProviderRequestError("Provider transport is not allowed", "INVALID_TRANSPORT");
    }
    const hostname = options.hostname.replace(/^\[|\]$/g, "");
    const host = hostname.includes(":") ? `[${hostname}]` : hostname;
    const url = new URL(`${options.protocol}//${host}${options.port ? `:${options.port}` : ""}`);
    assertProviderUrl(url);
    const addresses = await approvedAddresses(url);
    const expectedHostname = hostname.toLowerCase();
    const pinnedLookup: LookupFunction = (requestedHostname, lookupOptions, done) => {
      if (requestedHostname.replace(/^\[|\]$/g, "").toLowerCase() !== expectedHostname) {
        done(new ProviderRequestError("Provider origin is not allowed", "ORIGIN_MISMATCH"), "", 0);
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
        done(
          new ProviderRequestError("Provider hostname could not be resolved", "DNS_FAILED"),
          "",
          0,
        );
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
        finish(
          new ProviderRequestError("Provider connection address is not allowed", "PEER_MISMATCH"),
          null,
        );
        return;
      }
      finish(null, socket);
    });
  })().catch((error: unknown) =>
    finish(
      error instanceof ProviderRequestError
        ? error
        : new ProviderRequestError(
            "Could not connect to the provider. Check the settings and try again.",
            "CONNECTION_FAILED",
          ),
      null,
    ),
  );
};
const agent = new Agent({ connect: connector });

export function createProviderFetch(baseUrl: string): typeof globalThis.fetch {
  const expectedOrigin = new URL(baseUrl).origin;
  assertProviderUrl(new URL(baseUrl));
  const fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (
    input,
    init,
  ) => {
    let effectiveUrl: URL;
    try {
      effectiveUrl = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    } catch {
      throw new ProviderRequestError("Provider URL is invalid", "INVALID_URL");
    }
    assertProviderUrl(effectiveUrl, expectedOrigin);
    const request = typeof input === "object" && !(input instanceof URL) ? input : undefined;
    const options = {
      ...(request
        ? {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: request.signal,
            credentials: request.credentials,
            cache: request.cache,
            integrity: request.integrity,
            keepalive: request.keepalive,
            mode: request.mode,
            referrer: request.referrer,
            referrerPolicy: request.referrerPolicy,
          }
        : {}),
      ...init,
      dispatcher: agent,
      redirect: "manual",
    } as UndiciRequestInit;
    if (options.body && typeof options.body === "object" && "getReader" in options.body)
      options.duplex = "half";
    let response;
    try {
      response = await undiciFetch(effectiveUrl, options);
    } catch (error) {
      // Undici wraps connector failures in TypeError; retain fixed policy codes.
      if (error instanceof Error && error.cause instanceof ProviderRequestError) throw error.cause;
      throw error;
    }
    if (response.status >= 300 && response.status <= 399) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderRequestError("Provider redirect is not allowed", "REDIRECT_NOT_ALLOWED");
    }
    // Both implementations provide the Fetch response contract; their Blob/stream declarations differ.
    return response as unknown as Response;
  };
  // Bun adds a preconnect extension; SDK consumers use only the standard fetch call.
  return fetch as typeof globalThis.fetch;
}
