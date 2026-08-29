import { describe, expect, it } from "vitest";

import { retryTranslationOperation, TRANSLATION_RETRY_COUNT } from "./retry";

describe("retryTranslationOperation", () => {
  it("uses three retries after the initial attempt", async () => {
    expect(TRANSLATION_RETRY_COUNT).toBe(3);

    let attempts = 0;
    await expect(
      retryTranslationOperation(async () => {
        attempts += 1;
        if (attempts < 4) throw new Error(`failure-${attempts}`);
        return "ok";
      }),
    ).resolves.toBe("ok");

    expect(attempts).toBe(4);
  });

  it("rethrows the final failure unchanged after exhaustion", async () => {
    const finalError = new Error("final failure");
    let attempts = 0;

    await expect(
      retryTranslationOperation(async () => {
        attempts += 1;
        throw attempts === 4 ? finalError : new Error(`failure-${attempts}`);
      }),
    ).rejects.toBe(finalError);

    expect(attempts).toBe(4);
  });
});
