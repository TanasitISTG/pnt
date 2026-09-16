import type { ActiveJobState } from "@/lib/translation/types/api";

// Mutation responses are authoritative for the chapter they changed. The query
// can still deliver a response that was started before the mutation, so
// superseded job ids survive as tombstones until a different job is observed.
// Every transition below is pure: the hook keeps one state object in a ref and
// replaces it, which is what makes the protocol testable without React.

export interface ObservedTranslationJob {
  id: string;
  chapterId: string;
  status: ActiveJobState["status"];
  doneChunks: number;
  totalChunks: number;
  error: string | null;
}

export type ActiveTranslationJobList = ObservedTranslationJob[];

export interface TrackedJob {
  chapterId: string;
  jobId: string;
}

export interface JobAuthority {
  jobId: string;
  phase: "active" | "terminal";
  staleJobIds: Set<string>;
  suppressTerminalToast: boolean;
  state?: ActiveJobState;
}

export interface JobAuthorityState {
  mutationCounter: number;
  mutationVersions: Map<string, number>;
  authorities: Map<string, JobAuthority>;
  previousActiveJobs: Map<string, TrackedJob>;
  terminalChecks: Set<string>;
}

export function createJobAuthorityState(): JobAuthorityState {
  return {
    mutationCounter: 0,
    mutationVersions: new Map(),
    authorities: new Map(),
    previousActiveJobs: new Map(),
    terminalChecks: new Set(),
  };
}

export function beginMutation(
  state: JobAuthorityState,
  chapterIds: readonly string[],
): { state: JobAuthorityState; version: number } {
  const version = state.mutationCounter + 1;
  const mutationVersions = new Map(state.mutationVersions);
  for (const chapterId of new Set(chapterIds)) {
    mutationVersions.set(chapterId, version);
  }
  return { state: { ...state, mutationCounter: version, mutationVersions }, version };
}

export function ownsMutation(
  state: JobAuthorityState,
  chapterId: string,
  version: number,
): boolean {
  return state.mutationVersions.get(chapterId) === version;
}

export function rememberActiveJob(
  state: JobAuthorityState,
  job: ActiveJobState,
  version: number,
): { state: JobAuthorityState; accepted: boolean } {
  if (state.mutationVersions.get(job.chapterId) !== version) {
    return { state, accepted: false };
  }

  const authority = state.authorities.get(job.chapterId);
  const staleJobIds = new Set(authority?.staleJobIds ?? []);
  if (authority && authority.jobId !== job.jobId) staleJobIds.add(authority.jobId);
  const previous = state.previousActiveJobs.get(job.chapterId);
  if (previous && previous.jobId !== job.jobId) staleJobIds.add(previous.jobId);

  const authorities = new Map(state.authorities);
  authorities.set(job.chapterId, {
    jobId: job.jobId,
    phase: "active",
    staleJobIds,
    suppressTerminalToast: false,
    state: job,
  });
  const previousActiveJobs = new Map(state.previousActiveJobs);
  previousActiveJobs.set(job.chapterId, { chapterId: job.chapterId, jobId: job.jobId });
  return { state: { ...state, authorities, previousActiveJobs }, accepted: true };
}

export function rememberTerminalJob(
  state: JobAuthorityState,
  chapterId: string,
  jobId: string,
  suppressTerminalToast: boolean,
): JobAuthorityState {
  const authority = state.authorities.get(chapterId);
  const staleJobIds = new Set(authority?.staleJobIds ?? []);
  if (authority && authority.jobId !== jobId) staleJobIds.add(authority.jobId);

  const authorities = new Map(state.authorities);
  authorities.set(chapterId, { jobId, phase: "terminal", staleJobIds, suppressTerminalToast });

  if (state.previousActiveJobs.get(chapterId)?.jobId !== jobId) {
    return { ...state, authorities };
  }
  const previousActiveJobs = new Map(state.previousActiveJobs);
  previousActiveJobs.delete(chapterId);
  return { ...state, authorities, previousActiveJobs };
}

export function acceptObservedJob(
  state: JobAuthorityState,
  chapterId: string,
  jobId: string,
): { state: JobAuthorityState; accepted: boolean } {
  const authority = state.authorities.get(chapterId);
  if (!authority) return { state, accepted: true };
  if (authority.staleJobIds.has(jobId)) return { state, accepted: false };
  if (authority.phase === "terminal" && authority.jobId === jobId) {
    return { state, accepted: false };
  }
  if (authority.jobId !== jobId) {
    const staleJobIds = new Set(authority.staleJobIds);
    staleJobIds.add(authority.jobId);
    const authorities = new Map(state.authorities);
    authorities.set(chapterId, {
      jobId,
      phase: "active",
      staleJobIds,
      suppressTerminalToast: false,
    });
    return { state: { ...state, authorities }, accepted: true };
  }
  return { state, accepted: true };
}

export function forgetTrackedJob(state: JobAuthorityState, job: TrackedJob): JobAuthorityState {
  if (state.previousActiveJobs.get(job.chapterId)?.jobId !== job.jobId) return state;
  const previousActiveJobs = new Map(state.previousActiveJobs);
  previousActiveJobs.delete(job.chapterId);
  return { ...state, previousActiveJobs };
}

export function trackUnresolvedJob(state: JobAuthorityState, job: TrackedJob): JobAuthorityState {
  const authority = state.authorities.get(job.chapterId);
  if (authority?.jobId === job.jobId && authority.phase === "terminal") return state;
  const previousActiveJobs = new Map(state.previousActiveJobs);
  previousActiveJobs.set(job.chapterId, job);
  return { ...state, previousActiveJobs };
}

export interface ClaimedTerminalCheck {
  job: TrackedJob;
  mutationVersion: number | undefined;
}

export function claimTerminalChecks(
  state: JobAuthorityState,
  jobs: readonly TrackedJob[],
): { state: JobAuthorityState; claimed: ClaimedTerminalCheck[] } {
  const claimed: ClaimedTerminalCheck[] = [];
  let terminalChecks = state.terminalChecks;
  for (const job of jobs) {
    if (terminalChecks.has(job.jobId)) continue;
    if (terminalChecks === state.terminalChecks) terminalChecks = new Set(terminalChecks);
    terminalChecks.add(job.jobId);
    claimed.push({ job, mutationVersion: state.mutationVersions.get(job.chapterId) });
  }
  if (claimed.length === 0) return { state, claimed };
  return { state: { ...state, terminalChecks }, claimed };
}

export function releaseTerminalChecks(
  state: JobAuthorityState,
  jobIds: readonly string[],
): JobAuthorityState {
  const terminalChecks = new Set(state.terminalChecks);
  for (const jobId of jobIds) terminalChecks.delete(jobId);
  return { ...state, terminalChecks };
}

export interface PollReconciliation {
  state: JobAuthorityState;
  accepted: ObservedTranslationJob[];
  ignoredJobIds: string[];
  staleChapterIds: Set<string>;
  expectedJobsForCacheRewrite: ActiveJobState[];
  disappeared: TrackedJob[];
  replacedJobIds: Set<string>;
  nextPreviousActiveJobs: Map<string, TrackedJob>;
}

export function planPollReconciliation(
  state: JobAuthorityState,
  dbJobs: readonly ObservedTranslationJob[],
  activeJobs: ReadonlyMap<string, ActiveJobState>,
): PollReconciliation {
  let next = state;
  const accepted: ObservedTranslationJob[] = [];
  for (const job of dbJobs) {
    const result = acceptObservedJob(next, job.chapterId, job.id);
    next = result.state;
    if (result.accepted) accepted.push(job);
  }

  const acceptedJobIds = new Set(accepted.map((job) => job.id));
  const ignoredJobs = dbJobs.filter((job) => !acceptedJobIds.has(job.id));
  const ignoredJobIds = ignoredJobs.map((job) => job.id);
  const staleChapterIds = new Set(ignoredJobs.map((job) => job.chapterId));

  const expectedJobsForCacheRewrite: ActiveJobState[] = [];
  if (ignoredJobIds.length > 0) {
    for (const [chapterId, authority] of next.authorities) {
      if (authority.phase !== "active") continue;
      const local = activeJobs.get(chapterId);
      if (local?.jobId === authority.jobId) {
        expectedJobsForCacheRewrite.push(local);
      } else if (authority.state) {
        expectedJobsForCacheRewrite.push(authority.state);
      }
    }
  }

  const acceptedJobMap = new Map(accepted.map((job) => [job.chapterId, job]));
  const trackedJobs = new Map(next.previousActiveJobs);
  for (const [chapterId, authority] of next.authorities) {
    if (authority.phase === "terminal") {
      if (trackedJobs.get(chapterId)?.jobId === authority.jobId) trackedJobs.delete(chapterId);
      continue;
    }
    trackedJobs.set(chapterId, { chapterId, jobId: authority.jobId });
  }
  for (const job of activeJobs.values()) {
    if (job.status !== "pending" && job.status !== "running") continue;
    const authority = next.authorities.get(job.chapterId);
    if (authority?.phase === "terminal") continue;
    trackedJobs.set(job.chapterId, {
      chapterId: job.chapterId,
      jobId: authority?.phase === "active" ? authority.jobId : job.jobId,
    });
  }

  const disappeared = [...trackedJobs.values()].filter(
    (job) =>
      !staleChapterIds.has(job.chapterId) && acceptedJobMap.get(job.chapterId)?.id !== job.jobId,
  );
  const replacedJobIds = new Set(
    disappeared
      .filter((job) => {
        const replacement = acceptedJobMap.get(job.chapterId);
        return replacement !== undefined && replacement.id !== job.jobId;
      })
      .map((job) => job.jobId),
  );

  const nextPreviousActiveJobs = new Map<string, TrackedJob>(
    accepted.map((job) => [job.chapterId, { chapterId: job.chapterId, jobId: job.id }]),
  );
  for (const job of trackedJobs.values()) {
    if (acceptedJobMap.has(job.chapterId)) continue;
    if (next.authorities.get(job.chapterId)?.phase === "terminal") continue;
    nextPreviousActiveJobs.set(job.chapterId, job);
  }

  return {
    state: next,
    accepted,
    ignoredJobIds,
    staleChapterIds,
    expectedJobsForCacheRewrite,
    disappeared,
    replacedJobIds,
    nextPreviousActiveJobs,
  };
}

export type TerminalLookupDecision = "resolve" | "forget" | "defer";

export interface TerminalLookupContext {
  replacedJobIds: ReadonlySet<string>;
  lookupMutationVersion: number | undefined;
}

export function decideTerminalLookup(
  state: JobAuthorityState,
  job: TrackedJob,
  context: TerminalLookupContext,
): TerminalLookupDecision {
  if (context.replacedJobIds.has(job.jobId)) return "forget";
  if (state.mutationVersions.get(job.chapterId) !== context.lookupMutationVersion) return "forget";

  const authority = state.authorities.get(job.chapterId);
  if (
    authority &&
    (authority.jobId !== job.jobId ||
      (authority.phase === "terminal" && authority.jobId === job.jobId))
  ) {
    return "forget";
  }
  const tracked = state.previousActiveJobs.get(job.chapterId);
  if (tracked?.jobId && tracked.jobId !== job.jobId) return "defer";
  return "resolve";
}

export type TerminalOutcome =
  | { kind: "done" }
  | { kind: "error"; error: string | null }
  | { kind: "cancelled" }
  | { kind: "removed" }
  | { kind: "unresolved" };

export function mapTerminalOutcome(
  terminalJob: { status: string; error: string | null } | undefined,
): TerminalOutcome {
  if (!terminalJob) return { kind: "removed" };
  if (terminalJob.status === "done") return { kind: "done" };
  if (terminalJob.status === "error") return { kind: "error", error: terminalJob.error };
  if (terminalJob.status === "cancelled") return { kind: "cancelled" };
  return { kind: "unresolved" };
}

export function mergeJobState(
  activeJobs: Map<string, ActiveJobState>,
  state: ActiveJobState,
): Map<string, ActiveJobState> {
  const existing = activeJobs.get(state.chapterId);
  if (
    existing &&
    existing.jobId === state.jobId &&
    existing.status === state.status &&
    existing.doneChunks === state.doneChunks &&
    existing.totalChunks === state.totalChunks &&
    (existing.error ?? null) === (state.error ?? null)
  ) {
    return activeJobs;
  }
  const next = new Map(activeJobs);
  next.set(state.chapterId, state);
  return next;
}

export function removeJobIfMatches(
  activeJobs: Map<string, ActiveJobState>,
  chapterId: string,
  jobId: string,
): Map<string, ActiveJobState> {
  if (activeJobs.get(chapterId)?.jobId !== jobId) return activeJobs;
  const next = new Map(activeJobs);
  next.delete(chapterId);
  return next;
}

export function withJobFailure(
  activeJobs: Map<string, ActiveJobState>,
  chapterId: string,
  jobId: string,
  error: string | null,
): Map<string, ActiveJobState> {
  if (activeJobs.get(chapterId)?.jobId !== jobId) return activeJobs;
  const next = new Map(activeJobs);
  next.set(chapterId, { chapterId, jobId, status: "error", doneChunks: 0, totalChunks: 1, error });
  return next;
}
