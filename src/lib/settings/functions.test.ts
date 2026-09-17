import { describe, expect, it } from "vitest";

import { passwordChangeFailureMessage } from "@/lib/settings/functions";

function errorWith(extra: Record<string, unknown>): Error {
  return Object.assign(new Error("upstream detail"), extra);
}

describe("passwordChangeFailureMessage", () => {
  it("maps Better Auth's documented body.code to the fixed wrong-password message", () => {
    expect(passwordChangeFailureMessage(errorWith({ body: { code: "INVALID_PASSWORD" } }))).toBe(
      "Current password is incorrect.",
    );
  });
  it("maps only documented body.code (including nested cause) to the wrong-password message", () => {
    const withCause = errorWith({ cause: errorWith({ body: { code: "INVALID_PASSWORD" } }) });
    expect(passwordChangeFailureMessage(withCause)).toBe("Current password is incorrect.");
  });

  it("never maps a top-level code or message text", () => {
    expect(passwordChangeFailureMessage(errorWith({ code: "INVALID_PASSWORD" }))).toBe(
      "Could not change password. Try again.",
    );
    expect(passwordChangeFailureMessage(new Error("text mentioning INVALID_PASSWORD"))).toBe(
      "Could not change password. Try again.",
    );
  });
});
