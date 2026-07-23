import { describe, it, expect } from "vitest";

import { requireSession } from "@/lib/auth.functions";
import { UnauthorizedError } from "@/lib/server-fn-error";

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
});
