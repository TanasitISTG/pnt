import { describe, it, expect } from "vitest";

import { requireSession } from "@/lib/auth/functions";
import { ImpersonationReadOnlyError, UnauthorizedError } from "@/lib/server-fn-error";

describe("requireSession", () => {
  it("throws UnauthorizedError when session is null", () => {
    expect(() => requireSession(null)).toThrow(UnauthorizedError);
  });

  it("returns session object when authenticated session exists", () => {
    const mockSession = {
      user: {
        id: "user-1",
        email: "admin@example.com",
        name: "Admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true,
      },
      session: {
        id: "sess-1",
        userId: "user-1",
        expiresAt: new Date(),
        token: "tok",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    expect(requireSession(mockSession)).toBe(mockSession);
  });

  it("refuses a session an operator created as another account", () => {
    // Every mutation in the app authenticates through requireSession, so this one
    // refusal is what makes impersonation read-only everywhere.
    const impersonated = {
      user: {
        id: "user-1",
        email: "reader@example.com",
        name: "Reader",
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true,
      },
      session: {
        id: "sess-2",
        userId: "user-1",
        expiresAt: new Date(),
        token: "tok-2",
        createdAt: new Date(),
        updatedAt: new Date(),
        impersonatedBy: "operator-1",
      },
    };

    expect(() => requireSession(impersonated)).toThrow(ImpersonationReadOnlyError);
    expect(() => requireSession(impersonated)).toThrow(
      "Actions are unavailable while you are viewing as another account.",
    );
  });

  it("treats a blank impersonation value as an ordinary session", () => {
    const mockSession = {
      user: {
        id: "user-1",
        email: "reader@example.com",
        name: "Reader",
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true,
      },
      session: {
        id: "sess-3",
        userId: "user-1",
        expiresAt: new Date(),
        token: "tok-3",
        createdAt: new Date(),
        updatedAt: new Date(),
        impersonatedBy: null,
      },
    };

    expect(requireSession(mockSession)).toBe(mockSession);
  });
});
