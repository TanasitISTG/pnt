import { describe, expect, it } from "vitest";

import type { ActiveJobState } from "@/lib/translation/types/api";
import {
  acceptObservedJob,
  beginMutation,
  claimTerminalChecks,
  createJobAuthorityState,
  decideTerminalLookup,
  forgetTrackedJob,
  mapTerminalOutcome,
  mergeJobState,
  ownsMutation,
  planPollReconciliation,
  releaseTerminalChecks,
  rememberActiveJob,
  rememberTerminalJob,
  removeJobIfMatches,
  trackUnresolvedJob,
  withJobFailure,
  type JobAuthorityState,
  type ObservedTranslationJob,
} from "./job-authority";

function jobState(overrides: Partial<ActiveJobState> & { chapterId: string }): ActiveJobState {
  return {
    jobId: `job-${overrides.chapterId}`,
    status: "running",
    doneChunks: 0,
    totalChunks: 3,
    ...overrides,
  };
}

function observed(
  overrides: Partial<ObservedTranslationJob> & { chapterId: string; id: string },
): ObservedTranslationJob {
  return {
    status: "running",
    doneChunks: 0,
    totalChunks: 3,
    error: null,
    ...overrides,
  };
}

/** Records a job the way a mutation response does, on a fresh authority state. */
function stateWithRememberedJob(chapterId: string, jobId: string) {
  let state = createJobAuthorityState();
  const mutation = beginMutation(state, [chapterId]);
  state = mutation.state;
  const job = jobState({ chapterId, jobId });
  state = rememberActiveJob(state, job, mutation.version).state;
  return { state, version: mutation.version, job };
}

describe("mutation ownership", () => {
  it("only the newest version owns a chapter", () => {
    let state = createJobAuthorityState();
    const first = beginMutation(state, ["c1", "c2"]);
    state = first.state;
    const second = beginMutation(state, ["c1"]);
    state = second.state;

    expect(ownsMutation(state, "c1", first.version)).toBe(false);
    expect(ownsMutation(state, "c1", second.version)).toBe(true);
    expect(ownsMutation(state, "c2", first.version)).toBe(true);
    expect(ownsMutation(state, "c2", second.version)).toBe(false);
  });

  it("deduplicates repeated chapter ids", () => {
    const { state, version } = beginMutation(createJobAuthorityState(), ["c1", "c1", "c1"]);
    expect(state.mutationCounter).toBe(1);
    expect(ownsMutation(state, "c1", version)).toBe(true);
  });
});

describe("rememberActiveJob", () => {
  it("rejects a job whose mutation was superseded", () => {
    let state = createJobAuthorityState();
    const stale = beginMutation(state, ["c1"]);
    state = stale.state;
    const current = beginMutation(state, ["c1"]);
    state = current.state;

    const result = rememberActiveJob(
      state,
      jobState({ chapterId: "c1", jobId: "old" }),
      stale.version,
    );
    expect(result.accepted).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.authorities.size).toBe(0);
  });

  it("tombstones the replaced authority and the previous tracked job", () => {
    const first = stateWithRememberedJob("c1", "job-a");
    const second = beginMutation(first.state, ["c1"]);
    const state = rememberActiveJob(
      second.state,
      jobState({ chapterId: "c1", jobId: "job-b" }),
      second.version,
    ).state;

    const authority = state.authorities.get("c1");
    expect(authority?.jobId).toBe("job-b");
    expect(authority?.phase).toBe("active");
    expect([...(authority?.staleJobIds ?? [])]).toEqual(["job-a"]);
    expect(state.previousActiveJobs.get("c1")?.jobId).toBe("job-b");
  });
});

describe("acceptObservedJob", () => {
  it("accepts an unknown chapter without recording authority", () => {
    const state = createJobAuthorityState();
    const result = acceptObservedJob(state, "c1", "job-a");
    expect(result.accepted).toBe(true);
    expect(result.state).toBe(state);
    expect(result.state.authorities.size).toBe(0);
  });

  it("rejects a tombstoned job id", () => {
    const first = stateWithRememberedJob("c1", "job-a");
    const second = beginMutation(first.state, ["c1"]);
    const state = rememberActiveJob(
      second.state,
      jobState({ chapterId: "c1", jobId: "job-b" }),
      second.version,
    ).state;

    expect(acceptObservedJob(state, "c1", "job-a").accepted).toBe(false);
    expect(acceptObservedJob(state, "c1", "job-b").accepted).toBe(true);
  });

  it("rejects a job already remembered terminal", () => {
    const { state: remembered } = stateWithRememberedJob("c1", "job-a");
    const state = rememberTerminalJob(remembered, "c1", "job-a", false);
    expect(acceptObservedJob(state, "c1", "job-a").accepted).toBe(false);
  });

  it("rotates authority to a genuinely new job and tombstones the old id", () => {
    const { state } = stateWithRememberedJob("c1", "job-a");
    const rotated = acceptObservedJob(state, "c1", "job-b");

    expect(rotated.accepted).toBe(true);
    const authority = rotated.state.authorities.get("c1");
    expect(authority?.jobId).toBe("job-b");
    expect(authority?.phase).toBe("active");
    expect(authority?.suppressTerminalToast).toBe(false);
    expect([...(authority?.staleJobIds ?? [])]).toContain("job-a");
  });
});

describe("planPollReconciliation", () => {
  it("tracks accepted jobs and reports no disappearances", () => {
    const plan = planPollReconciliation(
      createJobAuthorityState(),
      [observed({ chapterId: "c1", id: "job-a" })],
      new Map(),
    );

    expect(plan.accepted.map((job) => job.id)).toEqual(["job-a"]);
    expect(plan.ignoredJobIds).toEqual([]);
    expect(plan.disappeared).toEqual([]);
    expect(plan.nextPreviousActiveJobs.get("c1")).toEqual({ chapterId: "c1", jobId: "job-a" });
  });

  it("ignores a poll row superseded by a mutation and rewrites the cache from the authority", () => {
    const first = stateWithRememberedJob("c1", "job-old");
    const mutation = beginMutation(first.state, ["c1"]);
    const expected = jobState({ chapterId: "c1", jobId: "job-new", doneChunks: 2 });
    const state = rememberActiveJob(mutation.state, expected, mutation.version).state;

    const plan = planPollReconciliation(
      state,
      [observed({ chapterId: "c1", id: "job-old" })],
      new Map([["c1", expected]]),
    );

    expect(plan.accepted).toEqual([]);
    expect(plan.ignoredJobIds).toEqual(["job-old"]);
    expect(plan.staleChapterIds.has("c1")).toBe(true);
    expect(plan.expectedJobsForCacheRewrite).toEqual([expected]);
    expect(plan.disappeared).toEqual([]);
  });

  it("falls back to the remembered authority state for the cache rewrite", () => {
    const first = stateWithRememberedJob("c1", "job-old");
    const mutation = beginMutation(first.state, ["c1"]);
    const remembered = jobState({ chapterId: "c1", jobId: "job-new", doneChunks: 1 });
    const state = rememberActiveJob(mutation.state, remembered, mutation.version).state;

    const plan = planPollReconciliation(
      state,
      [observed({ chapterId: "c1", id: "job-old" })],
      new Map(),
    );

    expect(plan.expectedJobsForCacheRewrite).toEqual([remembered]);
  });

  it("reports a replaced job when the poll accepts a different id", () => {
    const state = trackUnresolvedJob(createJobAuthorityState(), {
      chapterId: "c1",
      jobId: "job-a",
    });
    const activeJobs = new Map([["c1", jobState({ chapterId: "c1", jobId: "job-a" })]]);

    const plan = planPollReconciliation(
      state,
      [observed({ chapterId: "c1", id: "job-b" })],
      activeJobs,
    );

    expect(plan.accepted.map((job) => job.id)).toEqual(["job-b"]);
    expect(plan.disappeared.map((job) => job.jobId)).toEqual(["job-a"]);
    expect([...plan.replacedJobIds]).toEqual(["job-a"]);
  });

  it("excludes a chapter whose poll rows were all ignored from disappearance tracking", () => {
    const first = stateWithRememberedJob("c1", "job-old");
    const mutation = beginMutation(first.state, ["c1"]);
    const state = rememberActiveJob(
      mutation.state,
      jobState({ chapterId: "c1", jobId: "job-new" }),
      mutation.version,
    ).state;
    const activeJobs = new Map([["c1", jobState({ chapterId: "c1", jobId: "job-old" })]]);

    const plan = planPollReconciliation(
      state,
      [observed({ chapterId: "c1", id: "job-old" })],
      activeJobs,
    );

    expect(plan.staleChapterIds.has("c1")).toBe(true);
    expect(plan.disappeared).toEqual([]);
  });

  it("drops tracked jobs whose authority became terminal", () => {
    const { state: remembered } = stateWithRememberedJob("c1", "job-a");
    const state = rememberTerminalJob(remembered, "c1", "job-a", false);

    const plan = planPollReconciliation(state, [], new Map());

    expect(plan.disappeared).toEqual([]);
    expect(plan.nextPreviousActiveJobs.has("c1")).toBe(false);
  });

  it("keeps unresolved local jobs tracked when the poll returns nothing", () => {
    const activeJobs = new Map([
      ["c1", jobState({ chapterId: "c1", jobId: "job-a", status: "pending" })],
      ["c2", jobState({ chapterId: "c2", jobId: "job-b", status: "done" })],
    ]);

    const plan = planPollReconciliation(createJobAuthorityState(), [], activeJobs);

    expect(plan.disappeared.map((job) => job.jobId)).toEqual(["job-a"]);
    expect(plan.nextPreviousActiveJobs.get("c1")).toEqual({ chapterId: "c1", jobId: "job-a" });
    expect(plan.nextPreviousActiveJobs.has("c2")).toBe(false);
  });
});

describe("decideTerminalLookup", () => {
  const tracked = { chapterId: "c1", jobId: "job-a" };

  function authorityContext(terminal = false): {
    state: JobAuthorityState;
    context: { replacedJobIds: Set<string>; lookupMutationVersion: number };
  } {
    const remembered = stateWithRememberedJob("c1", "job-a");
    const state = terminal
      ? rememberTerminalJob(remembered.state, "c1", "job-a", false)
      : remembered.state;
    return {
      state,
      context: { replacedJobIds: new Set<string>(), lookupMutationVersion: remembered.version },
    };
  }

  it("forgets replaced jobs", () => {
    const { state, context } = authorityContext();
    context.replacedJobIds.add("job-a");
    expect(decideTerminalLookup(state, tracked, context)).toBe("forget");
  });

  it("forgets jobs whose mutation version changed during the lookup", () => {
    const { state, context } = authorityContext();
    state.mutationVersions.set("c1", context.lookupMutationVersion + 1);
    expect(decideTerminalLookup(state, tracked, context)).toBe("forget");
  });

  it("forgets jobs whose authority already moved on", () => {
    const { state, context } = authorityContext();
    state.authorities.set("c1", {
      jobId: "job-b",
      phase: "active",
      staleJobIds: new Set(),
      suppressTerminalToast: false,
    });
    expect(decideTerminalLookup(state, tracked, context)).toBe("forget");
  });

  it("forgets jobs already remembered terminal", () => {
    const { state, context } = authorityContext(true);
    expect(decideTerminalLookup(state, tracked, context)).toBe("forget");
  });

  it("defers while a different previous-active job is still tracked", () => {
    const { state, context } = authorityContext();
    state.previousActiveJobs.set("c1", { chapterId: "c1", jobId: "job-b" });
    expect(decideTerminalLookup(state, tracked, context)).toBe("defer");
  });

  it("resolves when the job still owns the chapter", () => {
    const { state, context } = authorityContext();
    expect(decideTerminalLookup(state, tracked, context)).toBe("resolve");
  });
});

describe("mapTerminalOutcome", () => {
  it("maps every terminal row and the missing-row case", () => {
    expect(mapTerminalOutcome({ status: "done", error: null })).toEqual({ kind: "done" });
    expect(mapTerminalOutcome({ status: "error", error: "boom" })).toEqual({
      kind: "error",
      error: "boom",
    });
    expect(mapTerminalOutcome({ status: "cancelled", error: null })).toEqual({ kind: "cancelled" });
    expect(mapTerminalOutcome(undefined)).toEqual({ kind: "removed" });
    expect(mapTerminalOutcome({ status: "running", error: null })).toEqual({ kind: "unresolved" });
  });
});

describe("active job map transitions", () => {
  const running = jobState({ chapterId: "c1", jobId: "job-a", doneChunks: 1 });

  it("returns the same map when the state is unchanged", () => {
    const map = new Map([["c1", running]]);
    expect(mergeJobState(map, { ...running })).toBe(map);
  });

  it("replaces the entry when progress changes", () => {
    const map = new Map([["c1", running]]);
    const next = mergeJobState(map, { ...running, doneChunks: 2 });
    expect(next).not.toBe(map);
    expect(next.get("c1")?.doneChunks).toBe(2);
  });

  it("only removes a job that still matches", () => {
    const map = new Map([["c1", running]]);
    expect(removeJobIfMatches(map, "c1", "job-b")).toBe(map);
    expect(removeJobIfMatches(map, "c1", "job-a").has("c1")).toBe(false);
  });

  it("forces an error state only for the matching job", () => {
    const map = new Map([["c1", running]]);
    expect(withJobFailure(map, "c1", "job-b", "boom")).toBe(map);
    const failed = withJobFailure(map, "c1", "job-a", "boom");
    expect(failed.get("c1")).toMatchObject({
      jobId: "job-a",
      status: "error",
      doneChunks: 0,
      totalChunks: 1,
      error: "boom",
    });
  });
});

describe("tracked job bookkeeping", () => {
  it("tracks claims once and releases them", () => {
    const state = createJobAuthorityState();
    const first = claimTerminalChecks(state, [{ chapterId: "c1", jobId: "job-a" }]);
    expect(first.claimed.map(({ job }) => job.jobId)).toEqual(["job-a"]);
    expect(first.state.terminalChecks.has("job-a")).toBe(true);
    expect(state.terminalChecks.has("job-a")).toBe(false);

    const second = claimTerminalChecks(first.state, [
      { chapterId: "c1", jobId: "job-a" },
      { chapterId: "c2", jobId: "job-b" },
    ]);
    expect(second.claimed.map(({ job }) => job.jobId)).toEqual(["job-b"]);

    const released = releaseTerminalChecks(second.state, ["job-a", "job-b"]);
    expect(released.terminalChecks.size).toBe(0);
  });

  it("snapshots the mutation version at claim time", () => {
    const remembered = stateWithRememberedJob("c1", "job-a");
    const claim = claimTerminalChecks(remembered.state, [{ chapterId: "c1", jobId: "job-a" }]);
    expect(claim.claimed[0].mutationVersion).toBe(remembered.version);
  });

  it("forgets only the matching tracked job", () => {
    const state = trackUnresolvedJob(createJobAuthorityState(), {
      chapterId: "c1",
      jobId: "job-a",
    });
    expect(forgetTrackedJob(state, { chapterId: "c1", jobId: "job-b" })).toBe(state);
    expect(
      forgetTrackedJob(state, { chapterId: "c1", jobId: "job-a" }).previousActiveJobs.size,
    ).toBe(0);
  });

  it("does not re-track a job whose authority is terminal", () => {
    const state = rememberTerminalJob(createJobAuthorityState(), "c1", "job-a", true);
    expect(trackUnresolvedJob(state, { chapterId: "c1", jobId: "job-a" })).toBe(state);
    expect(
      trackUnresolvedJob(state, { chapterId: "c1", jobId: "job-b" }).previousActiveJobs.get("c1"),
    ).toEqual({ chapterId: "c1", jobId: "job-b" });
  });
});
