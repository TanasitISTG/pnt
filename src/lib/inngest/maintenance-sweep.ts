/**
 * Run the maintenance sweep's independent jobs without letting either one starve the other.
 *
 * The two steps share a cron but not an outcome: an outbox dispatch failure must not stop a
 * scheduled chapter's notification fan-out, and a notification failure must not stop the
 * outbox retry. Both are started together, and a failure is rethrown only after both have
 * settled, so the run still fails (and Inngest retries the unfinished memoized step) while
 * the successful step is left complete.
 */
export async function runMaintenanceSweepSteps<TOutbox, TNotification>(steps: {
  outbox: () => Promise<TOutbox>;
  notifications: () => Promise<TNotification>;
}): Promise<{ outbox: TOutbox; notifications: TNotification }> {
  // The async wrappers start both callbacks before either outcome is awaited, so even a
  // synchronous throw cannot stop the second job from being invoked.
  const outbox = (async () => steps.outbox())();
  const notifications = (async () => steps.notifications())();
  const [outboxResult, notificationsResult] = await Promise.allSettled([outbox, notifications]);

  if (outboxResult.status === "rejected" && notificationsResult.status === "rejected") {
    throw new AggregateError(
      [outboxResult.reason, notificationsResult.reason],
      "Both maintenance sweep steps failed",
    );
  }
  if (outboxResult.status === "rejected") throw outboxResult.reason;
  if (notificationsResult.status === "rejected") throw notificationsResult.reason;

  return { outbox: outboxResult.value, notifications: notificationsResult.value };
}
