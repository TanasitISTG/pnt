/**
 * Run the maintenance sweep's independent jobs without letting any one starve the others.
 *
 * The steps share a cron but not an outcome: an outbox dispatch failure must not stop a
 * scheduled chapter's notification fan-out, a fan-out failure must not stop the outbox retry,
 * and a publication check that cannot run must not leave a scheduled chapter unchecked for
 * two reasons at once. All of them are started together, and a failure is rethrown only after
 * every step has settled, so the run still fails (and Inngest retries the unfinished memoized
 * step) while the successful steps are left complete.
 *
 * Publication runs first in intent rather than in order: it withholds a chapter whose text is
 * no longer publishable *before* its `publishedAt` arrives, while the fan-out only ever looks
 * at chapters that are already due, so the two cannot disagree about the same chapter.
 */
export async function runMaintenanceSweepSteps<TOutbox, TNotification, TPublication>(steps: {
  outbox: () => Promise<TOutbox>;
  notifications: () => Promise<TNotification>;
  publication: () => Promise<TPublication>;
}): Promise<{ outbox: TOutbox; notifications: TNotification; publication: TPublication }> {
  // The async wrappers start every job before any outcome is awaited, so even a synchronous
  // throw in the first cannot stop the others from being invoked.
  const outbox = (async () => steps.outbox())();
  const notifications = (async () => steps.notifications())();
  const publication = (async () => steps.publication())();
  const [outboxResult, notificationResult, publicationResult] = await Promise.allSettled([
    outbox,
    notifications,
    publication,
  ]);

  const failures: unknown[] = [];
  if (outboxResult.status === "rejected") failures.push(outboxResult.reason);
  if (notificationResult.status === "rejected") failures.push(notificationResult.reason);
  if (publicationResult.status === "rejected") failures.push(publicationResult.reason);

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Maintenance sweep steps failed");
  }

  return {
    outbox: (outboxResult as PromiseFulfilledResult<TOutbox>).value,
    notifications: (notificationResult as PromiseFulfilledResult<TNotification>).value,
    publication: (publicationResult as PromiseFulfilledResult<TPublication>).value,
  };
}
