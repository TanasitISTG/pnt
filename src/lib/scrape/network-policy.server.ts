import "@tanstack/react-start/server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { findSource } from "@/lib/scrape";

export function isPrivateIp(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "::" ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }

  if (isIP(normalized) === 6) {
    return (
      normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)
    );
  }

  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export async function assertPublicHost(url: string): Promise<void> {
  findSource(url);
  const hostname = new URL(url).hostname;
  if (isPrivateIp(hostname)) {
    throw new Error(`Private or local host access blocked: ${hostname}`);
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        throw new Error(`Private IP address blocked: ${address}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("blocked")) throw error;
    throw new Error(`DNS resolution failed for ${hostname}: ${message}`, { cause: error });
  }
}
