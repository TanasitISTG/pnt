import { describe, expect, it } from "vitest";

import { impersonationOperatorId } from "./impersonation";

describe("impersonationOperatorId", () => {
  it("reads the operator id off an impersonated session", () => {
    expect(impersonationOperatorId({ impersonatedBy: "operator-1" })).toBe("operator-1");
  });

  it("reports an ordinary session as not impersonating", () => {
    expect(impersonationOperatorId({ id: "session-1", userId: "user-1" })).toBeNull();
    expect(impersonationOperatorId({ impersonatedBy: null })).toBeNull();
  });

  it("treats a blank or malformed value as not impersonating", () => {
    // The column is free text, so anything that is not a usable id must not be
    // mistaken for an operator.
    expect(impersonationOperatorId({ impersonatedBy: "" })).toBeNull();
    expect(impersonationOperatorId({ impersonatedBy: 42 })).toBeNull();
  });

  it("survives a missing session", () => {
    expect(impersonationOperatorId(null)).toBeNull();
    expect(impersonationOperatorId(undefined)).toBeNull();
    expect(impersonationOperatorId("session")).toBeNull();
  });
});
