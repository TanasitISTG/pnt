import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  select: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator() {
      return this;
    },
    handler(handler: unknown) {
      return handler;
    },
  }),
  createServerOnlyFn: (handler: unknown) => handler,
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: vi.fn(() => new Headers()),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
}));
vi.mock("@/lib/auth/functions", () => ({ ensureSession: mocks.ensureSession }));
vi.mock("@/lib/auth/auth", () => ({ auth: {} }));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));
vi.mock("@/lib/settings/crypto", () => ({
  encrypt: mocks.encrypt,
  decrypt: vi.fn(),
}));
vi.mock("@/lib/translation/providers/provider-client", () => ({
  OpenAIProviderClient: vi.fn(),
  GeminiProviderClient: vi.fn(),
}));
vi.mock("@/lib/translation/providers/provider-network.server", () => ({
  assertProviderBaseUrl: vi.fn(),
  ProviderRequestError: class extends Error {},
}));

import {
  passwordChangeFailureMessage,
  saveProviderSettingsForUser,
} from "@/lib/settings/functions";

function errorWith(extra: Record<string, unknown>): Error {
  return Object.assign(new Error("upstream detail"), extra);
}

describe("saveProviderSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("preserves a concurrently changed API key during a metadata-only save", async () => {
    let persistedApiKey = "encrypted:old";

    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ apiKeyEnc: persistedApiKey }],
        }),
      }),
    });
    mocks.insert.mockReturnValue({
      values: () => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          persistedApiKey = "encrypted:concurrent";
          if ("apiKeyEnc" in set) persistedApiKey = String(set.apiKeyEnc);
        },
      }),
    });

    await saveProviderSettingsForUser("user-1", {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.6",
      temperature: 0.3,
    });
    expect(persistedApiKey).toBe("encrypted:concurrent");
  });
});

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
