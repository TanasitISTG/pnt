export interface RunnableJobState {
  id: string;
  status: string;
  generation: number;
  sourceRevision: number;
  doneChunks: number;
}

export interface ChapterJobState {
  activeTranslationJobId: string | null;
  translationGeneration: number;
  sourceRevision: number;
}

export interface TranslationRunIdentity {
  jobId: string;
  generation: number;
}

export const TRANSLATION_CANCEL_IF =
  "async.data.jobId == event.data.jobId && async.data.generation == event.data.generation";

export function translationRunIdentity(
  job: Pick<RunnableJobState, "id" | "generation">,
): TranslationRunIdentity {
  return { jobId: job.id, generation: job.generation };
}

export function isSameTranslationRun(
  left: TranslationRunIdentity,
  right: TranslationRunIdentity,
): boolean {
  return left.jobId === right.jobId && left.generation === right.generation;
}

export function canRunJob(
  job: RunnableJobState,
  chapter: ChapterJobState,
  eventGeneration: number,
): boolean {
  return (
    (job.status === "pending" || job.status === "running") &&
    job.generation === eventGeneration &&
    chapter.activeTranslationJobId === job.id &&
    chapter.translationGeneration === job.generation &&
    chapter.sourceRevision === job.sourceRevision
  );
}

export function isCompletedChunk(job: Pick<RunnableJobState, "doneChunks">, chunkIndex: number) {
  return chunkIndex < job.doneChunks;
}

export function isNextChunk(job: Pick<RunnableJobState, "doneChunks">, chunkIndex: number) {
  return chunkIndex === job.doneChunks;
}
