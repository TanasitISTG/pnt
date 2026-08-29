import { describe, expect, it } from "vitest";

import { createLog } from "./log-entry";

describe("createLog", () => {
  it("stores an absolute ISO timestamp for client-side localization", () => {
    const entry = createLog("info", "Started");

    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(new Date(entry.timestamp).getTime())).toBe(false);
  });
});
