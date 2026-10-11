import { describe, expect, it } from "vitest";

import { ADMIN_ROLE, hasAdminRole } from "./roles";

describe("hasAdminRole", () => {
  it("accepts the admin role", () => {
    expect(hasAdminRole(ADMIN_ROLE)).toBe(true);
  });

  it("accepts a comma-separated role list", () => {
    expect(hasAdminRole("user,admin")).toBe(true);
    expect(hasAdminRole("admin,user")).toBe(true);
    expect(hasAdminRole(" user , admin ")).toBe(true);
  });

  it("rejects a missing or unrelated role", () => {
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
    expect(hasAdminRole("")).toBe(false);
    expect(hasAdminRole("user")).toBe(false);
    expect(hasAdminRole("user,moderator")).toBe(false);
  });

  it("matches exactly, as the admin plugin does", () => {
    expect(hasAdminRole("Admin")).toBe(false);
    expect(hasAdminRole("administrator")).toBe(false);
    expect(hasAdminRole("superadmin")).toBe(false);
  });
});
