import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => new Headers({ cookie: "better-auth.session_token=stub" }),
}));

const { ensureSession, ensureSessionForRead } = await import("@/lib/auth/functions");
const { ImpersonationReadOnlyError, UnauthorizedError } = await import("@/lib/server-fn-error");

const sessionWith = (session: Record<string, unknown>) => ({
  user: {
    id: "user-1",
    email: "reader@example.com",
    name: "Reader",
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
    ...session,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The read side of read-only impersonation.
 *
 * `requireSession` (and therefore `ensureSession`) refuses an impersonated session, which
 * is what makes every mutation in the app unwritable while an operator views an account.
 * `ensureSessionForRead` deliberately does not: an operator whose reads were refused would
 * be looking at error pages instead of the account they asked to view, and the whole point
 * of the view is to read it. Both halves are asserted together so a future change cannot
 * quietly make the pair behave the same way.
 */
describe("ensureSessionForRead", () => {
  it("hands an impersonated session to a read", async () => {
    const impersonated = sessionWith({ impersonatedBy: "operator-1" });
    mocks.getSession.mockResolvedValue(impersonated);

    await expect(ensureSessionForRead()).resolves.toBe(impersonated);
  });

  it("still refuses a write through ensureSession", async () => {
    mocks.getSession.mockResolvedValue(sessionWith({ impersonatedBy: "operator-1" }));

    await expect(ensureSession()).rejects.toThrow(ImpersonationReadOnlyError);
  });

  it("requires an account for both", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(ensureSessionForRead()).rejects.toThrow(UnauthorizedError);
    await expect(ensureSession()).rejects.toThrow(UnauthorizedError);
  });

  it("passes an ordinary session through unchanged", async () => {
    const ordinary = sessionWith({});
    mocks.getSession.mockResolvedValue(ordinary);

    await expect(ensureSessionForRead()).resolves.toBe(ordinary);
    await expect(ensureSession()).resolves.toBe(ordinary);
  });
});
