import { describe, expect, it, vi } from "vitest";

import { runMaintenanceSweepSteps } from "./maintenance-sweep";

const published = async () => ({ checked: 0, withheld: 0 });

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
        publication: published,
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
        publication: published,
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
        publication: published,
      }),
    ).rejects.toBe(outboxError);

    expect(notifications).toHaveBeenCalledOnce();
  });

  it("keeps the publication check running when the other two jobs fail", async () => {
    const publication = vi.fn(async () => ({ checked: 4, withheld: 1 }));

    const error = await runMaintenanceSweepSteps({
      outbox: async () => {
        throw new Error("outbox unavailable");
      },
      notifications: async () => {
        throw new Error("fan-out unavailable");
      },
      publication,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(AggregateError);
    expect(publication).toHaveBeenCalledOnce();
  });

  it("surfaces the publication failure without hiding a settled sibling", async () => {
    const publicationError = new Error("publication check unavailable");
    const notifications = vi.fn(async () => 6);

    await expect(
      runMaintenanceSweepSteps({
        outbox: async () => 2,
        notifications,
        publication: async () => {
          throw publicationError;
        },
      }),
    ).rejects.toBe(publicationError);

    expect(notifications).toHaveBeenCalledOnce();
  });

  it("surfaces every failure once all jobs have settled", async () => {
    const outboxError = new Error("outbox unavailable");
    const notificationError = new Error("fan-out unavailable");
    const publicationError = new Error("publication check unavailable");

    const error = await runMaintenanceSweepSteps({
      outbox: async () => {
        throw outboxError;
      },
      notifications: async () => {
        throw notificationError;
      },
      publication: async () => {
        throw publicationError;
      },
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      outboxError,
      notificationError,
      publicationError,
    ]);
  });

  it("returns every result when each job succeeds", async () => {
    await expect(
      runMaintenanceSweepSteps({
        outbox: async () => 2,
        notifications: async () => 7,
        publication: async () => ({ checked: 3, withheld: 1 }),
      }),
    ).resolves.toEqual({ outbox: 2, notifications: 7, publication: { checked: 3, withheld: 1 } });
  });
});
