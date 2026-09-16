# Translation Workflow Architecture

## Objective

Make translation, chapter editing, glossary propagation, and event dispatch safe under concurrent requests, retries, cancellation, and partial infrastructure failure without changing the public server-function contracts used by the UI.

## Compatibility contract

- Existing server-function names, validators, response shapes, job statuses, and persisted chapter fields remain readable.
- Existing translation jobs remain queryable and terminal jobs remain immutable.
- A job retry resumes completed chunks only when its source revision still matches the chapter.
- Batch translation still reports ordered `queued` and `skipped` arrays.
- Translation, summary, title, glossary, and publication behavior remains available through the existing routes.

## Durable invariants

1. A chapter has at most one active translation job.
2. `chapters.active_translation_job_id` is the authority for which job may mutate chapter-derived state.
3. `chapters.source_revision` increments whenever source content, source title, or chapter number changes.
4. A job may write only while all of these remain true:
   - its status is the expected active status;
   - its generation matches the executing event;
   - its source revision matches the chapter;
   - the chapter points to that job as active.
5. Raw-content edits invalidate derived translation artifacts and supersede active work atomically.
6. Manual translation edits supersede active work and produce a consistent translated chapter state atomically.
7. Database state and an intent to dispatch an Inngest event commit in one transaction. Dispatch is at-least-once; the stable event `runKey` provides execution idempotency, and cancellation targets the exact `(job ID, generation)` run.
8. Translation jobs for one novel execute one at a time. This preserves chapter-order context and prevents concurrent rolling-summary writers. Different novels may execute concurrently.
9. Multi-record glossary propagation is atomic.
10. Session replay and DOM autocapture are disabled; optional telemetry is limited to page views and exception events after consent.
11. A novel has at most one active scrape or EPUB import job. Starting a new import cancels the previous active row in the same transaction; the partial unique index is the database backstop.
12. Relationship analysis is enabled for the canonical EN→TH, ZH→EN, and ZH→TH pairs and is non-fatal. It executes inside the memoized `chunk-N` step, immediately before that chunk's translation; provider or JSON validation failure logs a warning and falls back to matching enabled stored context. Run-stable context — approved glossary terms and the previous chapter's context tails — is loaded once per run in `init` and memoized for every chunk step.
13. Locked admin character and directed-relationship entries are never changed or re-enabled by automatic analysis. Unlocked entries may receive only source-evidenced, non-empty automatic semantic values; exact speech fields are scrubbed; caps discard new suggestions rather than evicting existing facts.
14. Relationship-map edits do not increment chapter source revision or cancel a translation job. They apply to subsequent not-yet-started `chunk-N` steps and future retranslations while preserving per-novel concurrency and finalization invariants.

15. Translation starts carry explicit `missing` or `overwrite` intent. Missing-mode enqueue skips nonblank retained translations; overwrite-mode jobs persist that intent and all retries revalidate the chapter under lock.
16. Guest novel and chapter reads apply live publication time, translated status, and nonblank translated-content filters. Ownership-checked admin reads remain independent of publication state; a live novel may have no guest-visible chapters.
17. New translation jobs persist provider/model/fast-model, source character count, and available input/output prices. Historical totals use stored prices; legacy rows are explicitly current-settings estimates or unpriced.
18. Job history and stats are retained reads, not activity sources. Active progress comes from the lean owned activity query; terminal transitions invalidate retained history/stats once.
19. Evaluation version 2 findings are bounded, immutable snapshot evidence with stable classifications, one-based paragraph locations when known, capped excerpts, and reader-anchor links. Corrections require a new report.
20. Reader manifests contain only navigation metadata. Full chapter bodies are loaded through the full chapter query, and reader anchors take precedence over saved scroll restoration.
21. Chapter deletion observes and locks the pointed translation job before locking the chapter, then revalidates the pointer. Active work is terminalized with an exact-generation cancellation outbox event before the chapter and cascaded job rows are deleted.

## State transitions

| Operation          | Job transition                                        | Chapter transition                                                  |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| Start              | prior active -> `cancelled`; new -> `pending`         | generation + 1, active job set, `queued`                            |
| Worker init        | `pending` -> `running`                                | `translating` if ownership still matches                            |
| Chunk complete     | `running` -> `running`                                | none                                                                |
| Finalize           | `running` -> `done`                                   | translation committed, active job cleared, `translated`             |
| Cancel             | active -> `cancelled`                                 | active job cleared; `translated` if content exists, otherwise `raw` |
| Failure            | active -> `error`                                     | active job cleared, `error`                                         |
| Retry              | `error`/`cancelled` -> `pending`, generation replaced | generation + 1, active job set, `queued`                            |
| Source edit        | active -> `cancelled`                                 | source revision + 1, active job cleared, derived state invalidated  |
| Manual translation | active -> `cancelled`                                 | active job cleared, coherent translated timestamps/status           |

## Persistence changes

- `chapters.source_revision integer not null default 1`

- `chapters.translation_generation integer not null default 0`
- `chapters.active_translation_job_id text null`
- `translation_jobs.source_revision integer not null default 1`
- `translation_jobs.generation integer not null default 1`
- `translation_job_chunks` rows keyed by `(job_id, chunk_index)` containing ordered source text, translation progress, token counts, latency, errors, and completion time.
- Partial unique index on active translation jobs by chapter.
- `workflow_outbox` table containing stable payloads and dispatch status for all workflow events.
- Translation jobs with null provider/pricing snapshot fields are legacy rows. They remain readable through current provider credentials, but any derived spend is labeled an estimate rather than historical actual.
- `getReaderNovel` and `getReaderChapterManifest` are the reader metadata boundaries; they must not grow full chapter bodies or admin-only fields.

Migration 0022 idempotently expands legacy `translation_jobs.chunks_json` arrays into chunk rows. The legacy column remains readable but dormant during the expand/contract rollback window; all current writes target `translation_job_chunks`.

The active-job column intentionally has no foreign key. Translation jobs already cascade when a chapter is deleted, while avoiding a circular foreign-key lifecycle lets the transaction clear ownership before or while terminalizing a job.

## Relationship-map continuity

Each novel stores one bounded version-1 relationship document in `novels.relationship_map_json`. The protected relationship editor applies one atomic, ownership-checked mutation at a time; an invalid persisted document is never silently overwritten.

For every canonical language pair, relationship analysis executes inside the memoized `chunk-N` step, immediately before that chunk's translation. Analysis receives the rolling summary, preceding raw-source tail, current raw chunk, enabled map, and approved character glossary mappings. Automatic analysis owns only source-evidenced semantic facts and directed active pairs; it does not invent exact target-language pronouns, addressee terms, or sentence particles. It may persist those semantic facts while the job still matches its generation, source revision, active chapter pointer, and `doneChunks` position. A later replay of the same chunk step re-derives the analysis and stays idempotent: the fact write is re-guarded by that same lock and cursor check, and a completed chunk is skipped before any provider call.

Unlocked exact speech fields are scrubbed and never reach the translator as authoritative guidance. Locked admin character and directed-relationship entries are authoritative and preserve their exact target-language speech choices against conflicting automatic evidence. Analysis failures do not fail translation: the worker logs a warning and uses enabled stored entries whose names match the source window. Automatic map updates do not increment chapter source revision or cancel active work; they affect later not-yet-started chunk steps and future retranslations. The relationship map travels with every chunk, while the memoized run context freezes approved glossary terms and the previous chapter's context tails for the whole run.

## Deterministic translation review

- Evaluation selection uses shared validation for positive decimal numbers and inclusive ranges; `all` has no chapter-count cutoff. Chapter bodies stream through a 25-row numeric-order cursor; only compact results accumulate.
- A quality report and its `translation/eval.requested` outbox event commit together. The report ID is the stable `runKey`. Attempts remain retryable; Inngest `onFailure` terminalizes active reports only after retries are exhausted.
- Completed/error reports are immutable. Conditional completion cannot overwrite a terminal snapshot. Rechecking creates a new report and never edits chapter, glossary, or translation-job state.
- Nonempty retained translations are evaluated regardless of chapter job status. Untranslated/whitespace-only content is skipped, not counted as clean or failed quality checks.
- Version-1 snapshots retain chapter timestamps and a fingerprint of the language pair and approved source/target mappings. Version-2 snapshots additionally retain at most 20 typed findings, one-based paragraph locations when known, capped source/translation excerpts, and glossary terms. Detail reads compare these with current data; publication-only timestamp changes conservatively mark findings changed. Deleted chapters have no navigation action, including in legacy reports.
- Stored JSON is validated before rendering. Malformed or inconsistent evidence is unavailable, not a clean result. Legacy reports preserve recorded metrics with unknown freshness and classification; new checks provide the missing metadata.
- Owner-only summaries omit raw JSON; detail responses return 10/25/50 rows. Review URLs preserve report/filter/page across reader edits and browser Back. Guest pages never request review data.

## Boundaries

- `translation/workflow/job-state.ts`: pure transition predicates and compatibility helpers.
- `translation/workflow/job-store.ts`: conditional persistence and atomic worker commits, including job-owned relationship-map analysis writes.
- `translation/workflow/run-context.ts`: the run-stable translation inputs (approved glossary terms, previous-chapter context tails) loaded once in `init` and reused by every memoized chunk step.
- `relationships/map.ts` and `relationships/schemas.ts`: bounded versioned documents, fail-closed parsing, directional merge rules, and prompt projections.
- `relationships/analyzer.ts`: non-fatal canonical-pair source-window analysis for a loaded chunk, plus fallback context.
- `backup.schemas.ts` and `backup.service.ts`: version-1 backup documents whose restore re-validates every field the database or a prompt would consume, restricts covers to decodable image media types, and whose export self-checks so anything written can be restored again.
- `relationships/functions.ts` and `relationships/service.ts`: authenticated ownership-checked relationship-map mutations.
- `import/commands.ts` is the transaction boundary for owned import replacement/cancellation; `import/job-store.ts` owns cursor advancement and replay-safe per-chapter outcomes.
- `job-dashboard/service.ts` owns the lean active-activity projection and retained history/stats remain separate read models.
- `translation/evaluation/eval.schemas.ts`, `eval.service.ts`, and `eval-worker.ts` own bounded versioned snapshots; review UI links findings to reader anchors without mutating reports.
- `inngest/outbox.ts`: workflow-wide durable event delivery; due rows compare against PostgreSQL `CURRENT_TIMESTAMP` so database visibility and eligibility use one clock.
- `export/stream.ts` and `/api/exports/$`: authenticated cursor-backed TXT/EPUB response streaming with numeric chapter ordering and `HEAD` support.
- `scrape.ts` and `scrape/parsers.ts`: client-safe source metadata and pure HTML parsing; `scrape/network-policy.server.ts` exclusively owns DNS resolution and private-address rejection.
- Route-facing server functions authenticate and delegate state transitions; they do not implement worker validity rules.
- Inngest orchestrates retries and per-novel concurrency but is not the source of truth for job validity.

## Backward-compatibility verification

The dedicated compatibility suite must cover public job shapes, stale-worker rejection, terminal-job immutability, migration defaults, ordered batch results, matching-revision retries, and migration-level uniqueness/outbox constraints.

Database integration tests require `TEST_DATABASE_URL` and exercise legacy chunk backfill/idempotence, the migration's partial unique index, concurrent production enqueues, stale finalization, failed outbox recovery, and streamed export ownership/order/headers/bytes against an isolated PostgreSQL service. They must never fall back to the application database.

The browser compatibility gate is `bun run test:e2e`. Its supervisor refuses database names without the `_e2e` suffix, owns local app/PostgreSQL/Inngest/OpenAI-stub lifecycles, uses an installed Chrome or Edge through Playwright on Node, and proves login, create, translate, publish, logout, and guest-read behavior without route interception.

## Deferred cleanup

After the expand/contract rollback window closes, remove the dormant `translation_jobs.chunks_json` column in a separate contract migration. Scrape responses remain bounded to 5 MB while streaming. Future storage or delivery changes must preserve the invariants and compatibility gates above.
