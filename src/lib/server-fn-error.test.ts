import { describe, it, expect } from "vitest";

import {
  withSafeHandler,
  UnauthorizedError,
  SafeServerError,
  RateLimitError,
} from "@/lib/server-fn-error";

describe("withSafeHandler", () => {
  it("returns result when underlying async fn succeeds", async () => {
    const res = await withSafeHandler(async () => "ok");
    expect(res).toBe("ok");
  });

  it("rethrows UnauthorizedError intact", async () => {
    await expect(
      withSafeHandler(async () => {
        throw new UnauthorizedError("Custom unauthorized");
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rethrows SafeServerError intact", async () => {
    await expect(
      withSafeHandler(async () => {
        throw new SafeServerError("Novel not found");
      }),
    ).rejects.toThrow("Novel not found");
  });

  it("catches unknown error and throws generic 'Something went wrong.'", async () => {
    await expect(
      withSafeHandler(async () => {
        throw new Error("relation novels does not exist in db");
      }),
    ).rejects.toThrow("Something went wrong.");
  });
});

describe("RateLimitError", () => {
  it("extends SafeServerError with the fixed name and message", () => {
    const err = new RateLimitError();
    expect(err instanceof RateLimitError).toBe(true);
    expect(err instanceof SafeServerError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("RateLimitError");
    expect(err.message).toBe("Too many requests");
  });

  it("passes through withSafeHandler unchanged", async () => {
    const original = new RateLimitError();
    await expect(
      withSafeHandler(async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });
});
