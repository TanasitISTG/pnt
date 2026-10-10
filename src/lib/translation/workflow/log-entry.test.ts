import { describe, expect, it } from "vitest";

import { appendLogEntry, createLog, parseLogEntries, serializeLogEntries } from "./log-entry";

describe("createLog", () => {
  it("stores an absolute ISO timestamp for client-side localization", () => {
    const entry = createLog("info", "Started");

    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(new Date(entry.timestamp).getTime())).toBe(false);
  });
});

describe("parseLogEntries", () => {
  it("recovers valid entries and marks malformed persisted JSON", () => {
    expect(parseLogEntries("{not-json")[0]?.level).toBe("warn");

    const recovered = parseLogEntries(JSON.stringify([{ level: "info", message: "ok" }, "bad"]));
    expect(recovered).toHaveLength(2);
    expect(recovered[0]?.message).toBe("ok");
    expect(recovered[1]?.level).toBe("warn");
  });

  it("keeps the newest bounded entries and caps messages", () => {
    const entries = Array.from({ length: 501 }, (_, index) => ({
      id: `log-${index}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "info",
      message: index === 500 ? "x".repeat(5_000) : `Message ${index}`,
    }));
    const parsed = parseLogEntries(JSON.stringify(entries));

    expect(parsed).toHaveLength(500);
    expect(parsed[0]?.id).toBe("log-1");
    expect(parsed.at(-1)?.message).toHaveLength(4_000);
    expect(appendLogEntry(JSON.stringify(entries), createLog("success", "Done"))).toContain(
      '"message":"Done"',
    );
  });

  it("bounds direct serialization used by workflow writes", () => {
    const serialized = serializeLogEntries(
      Array.from({ length: 501 }, (_, index) => createLog("info", `Message ${index}`)),
    );
    const parsed = parseLogEntries(serialized);

    expect(parsed).toHaveLength(500);
    expect(parsed[0]?.message).toBe("Message 1");
  });
});
