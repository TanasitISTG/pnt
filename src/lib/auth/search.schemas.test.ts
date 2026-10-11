import { describe, expect, it } from "vitest";

import {
  authRedirectSearchSchema,
  resetPasswordSearchSchema,
  verifyEmailSearchSchema,
} from "./search.schemas";

describe("auth search parameters", () => {
  it("accepts the numeric flag our own confirmation link carries", () => {
    // `/verify-email?verified=1` is what the confirmation email points at, and the
    // router's parser hands that over as the number 1. Rejecting it dropped a reader
    // who had just confirmed their address onto the error page.
    expect(verifyEmailSearchSchema.parse({ verified: 1 })).toEqual({ verified: 1 });
  });

  it.each([1, "1", true, "true"] as const)("reads %s as a set flag", (value) => {
    expect(verifyEmailSearchSchema.parse({ verified: value }).verified).toBeTruthy();
  });

  it.each([0, false, "", undefined, null] as const)("reads %s as an unset flag", (value) => {
    expect(verifyEmailSearchSchema.parse({ verified: value }).verified).toBeFalsy();
  });

  it("treats unreadable parameters as absent instead of failing the route", () => {
    expect(authRedirectSearchSchema.parse({ redirect: 1 }).redirect).toBeUndefined();
    expect(authRedirectSearchSchema.parse({ redirect: null }).redirect).toBeUndefined();
    expect(resetPasswordSearchSchema.parse({ token: null, error: 5 })).toEqual({
      token: undefined,
      error: undefined,
    });
    expect(verifyEmailSearchSchema.parse({ error: 7 }).error).toBeUndefined();
  });

  it("still reads the values Better Auth redirects with", () => {
    expect(resetPasswordSearchSchema.parse({ token: "eyJhbGciOiJIUzI1NiJ9.abc" }).token).toBe(
      "eyJhbGciOiJIUzI1NiJ9.abc",
    );
    expect(verifyEmailSearchSchema.parse({ error: "INVALID_TOKEN" }).error).toBe("INVALID_TOKEN");
    expect(authRedirectSearchSchema.parse({ redirect: "/novels/42" }).redirect).toBe("/novels/42");
  });
});
