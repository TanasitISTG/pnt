import { describe, expect, it, vi } from "vitest";

import { runMaintenanceSweepSteps } from "./maintenance-sweep";

describe("runMaintenanceSweepSteps", () => {
  it("still completes notifications when the outbox dispatch fails", async () => {
    const outboxError = new Error("outbox unavailable");
    let notificationsSettled = false;
    const notifications = vi.fn(async () => {
      await Promise.resolve();
      notificationsSettled = true;
      return 3;
    });

    await expect(
      runMaintenanceSweepSteps({
        outbox: async () => {
          throw outboxError;
        },
        notifications,
      }),
    ).rejects.toBe(outboxError);

    expect(notifications).toHaveBeenCalledOnce();
    expect(notificationsSettled).toBe(true);
  });

  it("still completes the outbox dispatch when notifications fail", async () => {
    const notificationError = new Error("fan-out unavailable");
    let outboxSettled = false;
    const outbox = vi.fn(async () => {
      await Promise.resolve();
      outboxSettled = true;
      return 5;
    });

    await expect(
      runMaintenanceSweepSteps({
        outbox,
        notifications: async () => {
          throw notificationError;
        },
      }),
    ).rejects.toBe(notificationError);

    expect(outbox).toHaveBeenCalledOnce();
    expect(outboxSettled).toBe(true);
  });

  it("still starts notifications when the outbox throws synchronously", async () => {
    const outboxError = new Error("outbox misconfigured");
    const notifications = vi.fn(async () => 3);

    await expect(
      runMaintenanceSweepSteps({
        outbox: () => {
          throw outboxError;
        },
        notifications,
      }),
    ).rejects.toBe(outboxError);

    expect(notifications).toHaveBeenCalledOnce();
  });

  it("surfaces both failures once both jobs have settled", async () => {
    const outboxError = new Error("outbox unavailable");
    const notificationError = new Error("fan-out unavailable");

    const error = await runMaintenanceSweepSteps({
      outbox: async () => {
        throw outboxError;
      },
      notifications: async () => {
        throw notificationError;
      },
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([outboxError, notificationError]);
  });

  it("returns both results when each job succeeds", async () => {
    await expect(
      runMaintenanceSweepSteps({
        outbox: async () => 2,
        notifications: async () => 7,
      }),
    ).resolves.toEqual({ outbox: 2, notifications: 7 });
  });
});
