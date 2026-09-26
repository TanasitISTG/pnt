import { beforeEach, describe, it, expect, vi } from "vitest";

const { envState, execute, getRequestHeaders, setResponseStatus, log } = vi.hoisted(() => ({
  envState: { RATE_LIMIT_TRUSTED_PROXY_HOPS: 0 },
  execute: vi.fn(),
  getRequestHeaders: vi.fn(),
  setResponseStatus: vi.fn(),
  log: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders,
  setResponseStatus,
}));
vi.mock("@/lib/db", () => ({
  db: { execute },
}));
vi.mock("@/lib/env", () => ({
  get env() {
    return envState;
  },
}));
vi.mock("@/lib/log", () => ({ log }));

import {
  checkGuestRateLimit,
  checkRateLimit,
  checkRateLimitForSubject,
  checkServerFnRateLimitForSubject,
  extractIp,
  isOverLimit,
} from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/server-fn-error";

beforeEach(() => {
  vi.resetAllMocks();
  envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 0;
  getRequestHeaders.mockReturnValue(new Headers());
  execute.mockResolvedValue([{ count: 1 }]);
});

describe("extractIp", () => {
  beforeEach(() => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 0;
  });

  it("ignores client-supplied forwarding headers when no proxy hop is trusted", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
    });
    expect(extractIp(headers)).toBeNull();
  });

  it("selects the hop appended by the single trusted proxy", () => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 1;
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.195, 150.172.238.178",
    });
    expect(extractIp(headers)).toBe("150.172.238.178");
  });

  it("walks the chain outward for multiple trusted proxies", () => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 2;
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
    });
    expect(extractIp(headers)).toBe("70.41.3.18");
  });

  it("rejects malformed chains and chains shorter than the trusted hop count", () => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 2;
    expect(extractIp(new Headers({ "x-forwarded-for": "150.172.238.178" }))).toBeNull();
    expect(
      extractIp(new Headers({ "x-forwarded-for": "not-an-address, 150.172.238.178" })),
    ).toBeNull();
  });

  it("returns null when x-forwarded-for is absent", () => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 1;
    expect(extractIp(new Headers())).toBeNull();
  });
});

describe("isOverLimit", () => {
  it("returns true when count exceeds limit", () => {
    expect(isOverLimit(61, 60)).toBe(true);
    expect(isOverLimit(10, 5)).toBe(true);
  });

  it("returns false when count is within or equal to limit", () => {
    expect(isOverLimit(60, 60)).toBe(false);
    expect(isOverLimit(1, 60)).toBe(false);
  });
});

describe("rate-limit request behavior", () => {
  it("accepts the final allowed request and sets 429 before rejecting the next request", async () => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 1;
    getRequestHeaders.mockReturnValue(new Headers({ "x-forwarded-for": "192.0.2.10" }));
    execute.mockResolvedValueOnce([{ count: 60 }]).mockResolvedValueOnce([{ count: 61 }]);

    await expect(checkRateLimit("guest-read", 60)).resolves.toBeUndefined();
    expect(setResponseStatus).not.toHaveBeenCalled();

    const events: string[] = [];
    setResponseStatus.mockImplementation((status: number) => events.push(`status:${status}`));
    await checkRateLimit("guest-read", 60).then(
      () => {
        throw new Error("Expected rate-limit rejection");
      },
      (error: unknown) => {
        events.push("rejected");
        expect(error).toBeInstanceOf(RateLimitError);
        expect(error).toMatchObject({ name: "RateLimitError", message: "Too many requests" });
      },
    );
    expect(events).toEqual(["status:429", "rejected"]);
    expect(log).not.toHaveBeenCalled();
  });

  it("limits raw HTTP headers without touching the TanStack response context", async () => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 1;
    execute.mockResolvedValueOnce([{ count: 60 }]).mockResolvedValueOnce([{ count: 61 }]);
    const headers = new Headers({ "x-forwarded-for": "192.0.2.10" });

    await expect(checkGuestRateLimit("read", 60, headers)).resolves.toBeUndefined();
    await expect(checkGuestRateLimit("read", 60, headers)).rejects.toBeInstanceOf(RateLimitError);
    expect(getRequestHeaders).not.toHaveBeenCalled();
    expect(setResponseStatus).not.toHaveBeenCalled();
  });
  it.each([
    ["epub-upload-create", 6],
    ["epub-upload-chunk", 120],
  ])("returns HTTP 429 when the %s account quota is exceeded", async (bucket, limit) => {
    execute.mockResolvedValueOnce([{ count: limit }]).mockResolvedValueOnce([{ count: limit + 1 }]);

    await expect(
      checkServerFnRateLimitForSubject(bucket, "user-1", limit),
    ).resolves.toBeUndefined();
    expect(setResponseStatus).not.toHaveBeenCalled();
    await expect(checkServerFnRateLimitForSubject(bucket, "user-1", limit)).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(setResponseStatus).toHaveBeenCalledTimes(1);
    expect(setResponseStatus).toHaveBeenCalledWith(429);
    expect(getRequestHeaders).not.toHaveBeenCalled();
  });

  it("accepts wrapped driver rows without treating an ordinary count as a storage failure", async () => {
    execute.mockResolvedValue({ rows: [{ count: 60 }] });
    await expect(checkRateLimitForSubject("upload", "user-1", 60)).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
    expect(setResponseStatus).not.toHaveBeenCalled();
  });

  it("allows requests after a database failure and records the operational failure", async () => {
    execute.mockRejectedValue(new Error("database unavailable"));
    await expect(checkRateLimitForSubject("upload", "user-1", 60)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("error", "rate-limit check failed", {
      error: "database unavailable",
    });
    expect(setResponseStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["missing rows", []],
    ["missing count", [{}]],
    ["zero", [{ count: 0 }]],
    ["negative", [{ count: -1 }]],
    ["fractional", [{ count: 1.5 }]],
    ["infinite", [{ count: Infinity }]],
    ["not numeric", [{ count: "invalid" }]],
    ["invalid driver envelope", {}],
    ["null driver result", null],
  ])("allows requests with a malformed database result: %s", async (_label, result) => {
    execute.mockResolvedValue(result);
    await expect(checkRateLimitForSubject("upload", "user-1", 60)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("error", "rate-limit check failed", {
      error: expect.any(String),
    });
    expect(setResponseStatus).not.toHaveBeenCalled();
  });

  it("skips database limiting rather than pooling untrusted clients into one bucket", async () => {
    getRequestHeaders.mockReturnValue(new Headers({ "x-forwarded-for": "192.0.2.10" }));
    await expect(checkRateLimit("guest-read", 60)).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", "rate-limit skipped without trusted client IP", {});
    expect(setResponseStatus).not.toHaveBeenCalled();
  });

  it("also allows a trusted guest read when database limiting is unavailable", async () => {
    envState.RATE_LIMIT_TRUSTED_PROXY_HOPS = 1;
    getRequestHeaders.mockReturnValue(new Headers({ "x-forwarded-for": "192.0.2.10" }));
    execute.mockRejectedValue(new Error("connection closed"));
    await expect(checkRateLimit("guest-read", 60)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("error", "rate-limit check failed", {
      error: "connection closed",
    });
    expect(setResponseStatus).not.toHaveBeenCalled();
  });
});
