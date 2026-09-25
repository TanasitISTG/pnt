import { describe, expect, it } from "vitest";

import { parseScraperBase } from "./env";

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
