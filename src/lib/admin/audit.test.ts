import { describe, expect, it } from "vitest";

import { ADMIN_ACTIONS, describeAdminAction, isAdminAction } from "./audit";

describe("describeAdminAction", () => {
  it("labels every recorded action", () => {
    for (const action of ADMIN_ACTIONS) {
      // An unlabelled action would render as its raw dotted name on the operator
      // screen, which is the one thing a reader cannot act on.
      expect(describeAdminAction(action)).not.toBe(action);
    }
  });

  it("falls back to the stored value for an action written by a later version", () => {
    expect(describeAdminAction("account.exported")).toBe("account.exported");
  });
});

describe("isAdminAction", () => {
  it("accepts the vocabulary and rejects anything else", () => {
    expect(isAdminAction("account.banned")).toBe(true);
    expect(isAdminAction("account.banned ")).toBe(false);
    expect(isAdminAction("role.granted.everything")).toBe(false);
  });
});
