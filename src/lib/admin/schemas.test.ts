import { describe, expect, it } from "vitest";

import {
  ADMIN_ACTIVITY_PAGE_SIZE,
  ADMIN_USERS_PAGE_SIZE,
  adminActivityInputSchema,
  adminUserListInputSchema,
  setUserBannedSchema,
} from "./schemas";

describe("adminUserListInputSchema", () => {
  it("fills in defaults for an empty search", () => {
    expect(adminUserListInputSchema.parse({})).toEqual({
      q: "",
      page: 1,
      pageSize: ADMIN_USERS_PAGE_SIZE,
    });
  });

  it("trims the search term", () => {
    expect(adminUserListInputSchema.parse({ q: "  reader@example.test  " }).q).toBe(
      "reader@example.test",
    );
  });

  it("coerces paging from URL strings", () => {
    const parsed = adminUserListInputSchema.parse({ page: "3", pageSize: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
  });

  it("degrades an out-of-range page to the default instead of throwing", () => {
    // A hand-edited URL must not break the operator's own page, so an out-of-range
    // value is caught by the field and normalized, not raised to the router.
    expect(adminUserListInputSchema.parse({ page: "0" }).page).toBe(1);
    expect(adminUserListInputSchema.parse({ pageSize: "5000" }).pageSize).toBe(
      ADMIN_USERS_PAGE_SIZE,
    );
  });
});

describe("setUserBannedSchema", () => {
  it("accepts a suspension with a reason and an expiry", () => {
    const parsed = setUserBannedSchema.parse({
      userId: "user-1",
      banned: true,
      banReason: "  spam  ",
      banExpiresInDays: 7,
    });
    expect(parsed.banReason).toBe("spam");
    expect(parsed.banExpiresInDays).toBe(7);
  });

  it("accepts a permanent suspension with no reason", () => {
    expect(setUserBannedSchema.parse({ userId: "user-1", banned: true })).toEqual({
      userId: "user-1",
      banned: true,
    });
  });

  it("rejects a reason longer than the stored limit", () => {
    expect(() =>
      setUserBannedSchema.parse({ userId: "user-1", banned: true, banReason: "x".repeat(201) }),
    ).toThrow();
  });
});

describe("adminActivityInputSchema", () => {
  it("fills in defaults for an empty query", () => {
    expect(adminActivityInputSchema.parse({})).toEqual({
      page: 1,
      pageSize: ADMIN_ACTIVITY_PAGE_SIZE,
    });
  });

  it("degrades an out-of-range page to the first one", () => {
    // Same treatment as the account list: a hand-edited URL must not reach the router
    // as a validation error on the operator's own page.
    expect(adminActivityInputSchema.parse({ page: "0" }).page).toBe(1);
    expect(adminActivityInputSchema.parse({ pageSize: "5000" }).pageSize).toBe(
      ADMIN_ACTIVITY_PAGE_SIZE,
    );
  });
});
