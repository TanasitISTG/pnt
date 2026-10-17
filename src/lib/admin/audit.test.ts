import { describe, expect, it } from "vitest";

import { adminActionKey, ADMIN_ACTIONS, isAdminAction } from "./audit";

describe("adminActionKey", () => {
  it("names a catalog key for every recorded action", () => {
    for (const action of ADMIN_ACTIONS) {
      // A key rather than a sentence, and a key that exists: an unmapped action would
      // render as its raw dotted name on the operator screen, which is the one thing a
      // reader cannot act on. The catalog itself is checked by `bun run i18n:check`.
      const key = adminActionKey(action);
      expect(key).not.toBeNull();
      expect(key).toMatch(/^action[A-Z]/);
    }
  });

  it("returns null for an action written by a later version", () => {
    // The screen falls back to the stored value, so a newer deploy's row still renders.
    expect(adminActionKey("account.exported")).toBeNull();
  });
});

describe("isAdminAction", () => {
  it("accepts the vocabulary and rejects anything else", () => {
    expect(isAdminAction("account.banned")).toBe(true);
    expect(isAdminAction("account.banned ")).toBe(false);
    expect(isAdminAction("role.granted.everything")).toBe(false);
  });
});
