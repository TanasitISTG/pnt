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

11. Relationship analysis is ZH→TH-only and non-fatal. The memoized `context-N` step runs immediately before `chunk-N`; provider or JSON validation failure logs a warning and falls back to matching enabled stored context.
12. Automatic relationship-map writes use the same locked job/chapter/novel transaction and generation, source-revision, `doneChunks`, and active-job ownership checks as chunk writes.
13. Locked admin character and directed-relationship entries are never changed or re-enabled by automatic analysis. Unlocked entries may receive only source-evidenced, non-empty automatic values; caps discard new suggestions rather than evicting existing facts.
14. Relationship-map edits do not increment chapter source revision or cancel a translation job. They apply to subsequent not-yet-started `context-N`/translation steps and future retranslations while preserving per-novel concurrency and finalization invariants.

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
- `translation_outbox` table containing stable payloads and dispatch status.

Migration 0022 idempotently expands legacy `translation_jobs.chunks_json` arrays into chunk rows. The legacy column remains readable but dormant during the expand/contract rollback window; all current writes target `translation_job_chunks`.

The active-job column intentionally has no foreign key. Translation jobs already cascade when a chapter is deleted, while avoiding a circular foreign-key lifecycle lets the transaction clear ownership before or while terminalizing a job.

## Relationship-map continuity

Each novel stores one bounded version-1 relationship document in `novels.relationship_map_json`. The protected relationship editor applies one atomic, ownership-checked mutation at a time; an invalid persisted document is never silently overwritten.

For a ZH→TH job, Inngest executes memoized `context-N` immediately before `chunk-N`. Analysis receives the rolling summary, preceding raw-source tail, current raw chunk, enabled map, and approved character glossary mappings. It may persist only source-evidenced automatic facts while the job still matches its generation, source revision, active chapter pointer, and `doneChunks` position. A later replay of the same context step is idempotent.

Locked admin entries are authoritative and survive conflicting automatic evidence. Analysis failures do not fail translation: the worker logs a warning and uses enabled stored entries whose names match the source window. Automatic map updates do not increment chapter source revision or cancel active work; they affect later not-yet-started context/translation steps and future retranslations.

## Boundaries

- `translation/job-state.ts`: pure transition predicates and compatibility helpers.
- `translation/job-store.ts`: conditional persistence and atomic worker commits, including job-owned relationship-map analysis writes.
- `relationships/map.ts` and `relationships/schemas.ts`: bounded versioned documents, fail-closed parsing, directional merge rules, and prompt projections.
- `relationships/analyzer.ts`: non-fatal ZH→TH source-window analysis and fallback context.
- `relationships/functions.ts` and `relationships/service.ts`: authenticated ownership-checked relationship-map mutations.
- `translation/outbox.ts`: durable event delivery; due rows compare against PostgreSQL `CURRENT_TIMESTAMP` so database visibility and eligibility use one clock.
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
