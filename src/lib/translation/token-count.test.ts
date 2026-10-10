import { describe, expect, it } from "vitest";

import {
  assertPersistableTokenCount,
  MAX_PERSISTED_TOKEN_COUNT,
  sumPersistableTokenCounts,
} from "./token-count";

describe("persisted token counts", () => {
  it("accepts the PostgreSQL integer boundary", () => {
    expect(() => assertPersistableTokenCount(MAX_PERSISTED_TOKEN_COUNT)).not.toThrow();
  });

  it.each([-1, 1.5, MAX_PERSISTED_TOKEN_COUNT + 1])(
    "rejects a non-persistable count (%s)",
    (value) => {
      expect(() => assertPersistableTokenCount(value)).toThrow(
        "Token count exceeds the persistence limit",
      );
    },
  );

  it("rejects aggregates that overflow even when each response is valid", () => {
    expect(() => sumPersistableTokenCounts(MAX_PERSISTED_TOKEN_COUNT, 1)).toThrow(
      "Token count exceeds the persistence limit",
    );
  });
});
