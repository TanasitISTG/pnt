import { describe, it, expect } from "vitest";

import { withSafeHandler, UnauthorizedError, SafeServerError } from "@/lib/server-fn-error";

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
