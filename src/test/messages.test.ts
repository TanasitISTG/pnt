import { describe, expect, it } from "vitest";

import { providerFailureCodes } from "@/lib/translation/providers/provider-failures";
import { logMessage } from "@/lib/translation/workflow/log-entry";

import { englishWords, rejectionOf, thrownBy } from "./messages";

/**
 * The helper the server-side suites assert copy with.
 *
 * A provider failure travels as a code rather than a sentence, so those suites resolve the code
 * here instead of matching it against itself: what they compare is the words a reader sees. These
 * cases hold the helper to the three shapes a stored message can take.
 */

describe("englishWords", () => {
  it("resolves a catalog code to the English sentence", () => {
    expect(englishWords(providerFailureCodes.RATE_LIMITED)).toBe(
      "Provider rate limit reached. Try again later.",
    );
  });

  it("resolves a value nested inside a code, which is how a log row names a failure", () => {
    expect(
      englishWords(
        logMessage("relationshipAnalysisUnavailable", {
          reason: providerFailureCodes.RATE_LIMITED,
        }),
      ),
    ).toBe("Relationship analysis unavailable: Provider rate limit reached. Try again later.");
  });

  it("passes a sentence that is data through untouched", () => {
    expect(englishWords("Upstream said something")).toBe("Upstream said something");
  });

  it("returns a code no catalog defines as it stands, rather than as a blank", () => {
    // The same case the log drawer falls back on: a row written by a release whose key has since
    // been renamed still reads as what was stored.
    expect(englishWords("log.aKeyThatMoved")).toBe("log.aKeyThatMoved");
  });
});

describe("rejectionOf", () => {
  it("hands back the error a call rejected with", async () => {
    const failure = await rejectionOf(Promise.reject(new Error("boom")));
    expect(failure.message).toBe("boom");
  });

  it("fails the test when the call was expected to fail and did not", async () => {
    await expect(rejectionOf(Promise.resolve("fine"))).rejects.toThrow(
      "expected the call to reject, but it resolved",
    );
  });
});

describe("thrownBy", () => {
  it("hands back the error a call threw", () => {
    expect(
      thrownBy(() => {
        throw new Error("refused");
      }).message,
    ).toBe("refused");
  });

  it("fails the test when the call was expected to throw and did not", () => {
    expect(() => thrownBy(() => "fine")).toThrow("expected the call to throw, but it returned");
  });
});
