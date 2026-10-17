import { describe, it, expect } from "vitest";

import { encodeMessage } from "@/lib/i18n/message-code";
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
        throw new SafeServerError(encodeMessage("errors.novelNotFound"));
      }),
    ).rejects.toThrow(encodeMessage("errors.novelNotFound"));
  });

  it("catches unknown error and throws the generic safe message", async () => {
    await expect(
      withSafeHandler(async () => {
        throw new Error("relation novels does not exist in db");
      }),
    ).rejects.toThrow(encodeMessage("common.somethingWentWrong"));
  });
});

describe("RateLimitError", () => {
  it("extends SafeServerError with the fixed name and message", () => {
    const err = new RateLimitError();
    expect(err instanceof RateLimitError).toBe(true);
    expect(err instanceof SafeServerError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("RateLimitError");
    // The message is a code, so the reader resolves it in their own language. Asserting the
    // key rather than a sentence is what keeps this test honest if the key is ever renamed.
    expect(err.message).toBe(encodeMessage("errors.rateLimited"));
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
