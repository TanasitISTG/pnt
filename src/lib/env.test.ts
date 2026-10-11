import { afterEach, describe, expect, it, vi } from "vitest";

import { parseScraperBase, parseStorageBaseUrl, r2ConfigurationIssues, R2_ENV_KEYS } from "./env";

describe("parseScraperBase", () => {
  it("accepts and normalizes a path on the canonical ZenRows origin", () => {
    expect(parseScraperBase("https://api.zenrows.com/v1/")).toBe("https://api.zenrows.com/v1/");
  });

  it.each([
    "https://api.zenrows.com@attacker.example/",
    "https://api.zenrows.com.attacker.example/",
    "http://api.zenrows.com/v1/",
    "https://api.zenrows.com:444/v1/",
    "https://user:secret@api.zenrows.com/v1/",
    "https://api.zenrows.com/v1/?target=other",
    "https://api.zenrows.com/v1/#fragment",
  ])("rejects a noncanonical or credential-bearing endpoint: %s", (value) => {
    expect(() => parseScraperBase(value)).toThrow(
      "SCRAPER_BASE must use the canonical ZenRows origin",
    );
  });
});

describe("parseStorageBaseUrl", () => {
  it("accepts a canonical HTTPS origin", () => {
    expect(parseStorageBaseUrl("https://cdn.example.com")).toBe("https://cdn.example.com");
  });

  it.each([
    "http://cdn.example.com",
    "https://cdn.example.com/",
    "https://cdn.example.com/covers",
    "https://cdn.example.com/?v=1",
    "https://cdn.example.com/#top",
    "https://user:secret@cdn.example.com",
    "https://cdn.example.com:443",
  ])("rejects a noncanonical public origin: %s", (value) => {
    expect(() => parseStorageBaseUrl(value)).toThrow(
      "R2_PUBLIC_BASE_URL must be a canonical HTTPS origin",
    );
  });
});

describe("r2ConfigurationIssues", () => {
  const complete: Record<string, string> = Object.fromEntries(
    R2_ENV_KEYS.map((key) => [key, "value"]),
  );

  it("accepts a complete configuration", () => {
    expect(r2ConfigurationIssues(complete)).toEqual([]);
  });

  it("accepts an absent configuration off Vercel so the app boots keyless", () => {
    expect(r2ConfigurationIssues({})).toEqual([]);
  });

  it("requires storage on Vercel", () => {
    const issues = r2ConfigurationIssues({ VERCEL: "1" });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("required on Vercel");
  });

  it("rejects a partially configured bucket instead of mixing backends", () => {
    const partial: Record<string, string> = { ...complete };
    delete partial[R2_ENV_KEYS[1]];
    delete partial[R2_ENV_KEYS[3]];

    expect(r2ConfigurationIssues(partial)).toEqual([
      { path: [R2_ENV_KEYS[1]], message: "required when R2 is configured" },
      { path: [R2_ENV_KEYS[3]], message: "required when R2 is configured" },
    ]);
  });
});

// Bun defines `KEY=` in the process environment as an empty string, so a developer who
// copies `.env.example` verbatim must still boot on the filesystem adapter.
describe("R2 environment parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads blank template entries as unconfigured", async () => {
    vi.resetModules();
    for (const key of R2_ENV_KEYS) vi.stubEnv(key, "");

    const { env } = await import("./env");

    for (const key of R2_ENV_KEYS) expect(env[key]).toBeUndefined();
  });

  it.each([
    ["one filled account ID", { [R2_ENV_KEYS[0]]: "account" }],
    ["every key but the public origin", { [R2_ENV_KEYS[4]]: "bucket" }],
  ])("rejects a partially filled configuration: %s", async (_case, filled) => {
    vi.resetModules();
    for (const key of R2_ENV_KEYS) vi.stubEnv(key, "");
    for (const [key, value] of Object.entries(filled)) vi.stubEnv(key, value);

    await expect(import("./env")).rejects.toThrow(/R2|required when R2 is configured/);
  });
});
