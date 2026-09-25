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
21. Chapter deletion first acquires the owned novel gate, then observes and locks the pointed translation job before locking the chapter and revalidating the pointer. Active work is terminalized with an exact-generation cancellation outbox event before the chapter and cascaded job rows are deleted; matching reader positions are cleared in the same transaction.
22. Signed-in reader state is account-scoped and single-writer per `(user, novel)`. Opening a chapter preserves the stored fraction only for that chapter and resets it otherwise; a scroll sample for any other chapter is dropped rather than overwriting the newer position; read marks are idempotent. Guests keep the browser-local equivalent, and reader settings stay browser-local for everyone.

## Novel-first mutation protocol

Participating mutations acquire all required novel rows before any descendant locks or
writes. Parent discovery is a plain read used only to locate the gate, not a mutation
snapshot. `db/novel-lock.ts` provides the single-row `FOR UPDATE OF novels` gate; request
callers include the authenticated owner, while workers derive the novel from persisted
job linkage. Existing domain-specific novel-only gates remain valid.

After waiting for the gate, reread child state and revalidate parent linkage, ownership,
active pointers, source revision, generation, status, and chunk cursor as applicable.
The gate does not replace worker CAS checks. Operations spanning multiple novels discover,
deduplicate, sort IDs, and await one novel lock at a time in ascending order before touching
descendants; they never acquire an additional novel after a descendant lock. There is no
global child-table lock order and no generic contention retry substitute for this protocol.

The gate covers translation enqueue/retry/cancellation and worker commits, chapter changes
and deletion, publication, glossary and relationship writes, import chapter commits and
resource cleanup, and reader position/read-mark/bookmark creation. Provider I/O remains
outside transactions; missing-title generation takes a short gated persistence transaction
with revision/generation/eligibility guards only after the provider returns. Bookmark
note/deletion and import status-only writes are leaf exceptions: they acquire no later
parent locks. New-novel backup inserts do not lock preexisting novels.

EPUB admission alone locks the account row before its owned novel gate to serialize
cross-novel capacity checks; no participant may acquire an account lock after a novel gate.
Novel deletion cancels active translation and import jobs and writes cancellation intents
before cascading descendants in the same transaction. Best-effort dispatch occurs after
commit; durable outbox intents survive the cascade, and late worker writes cannot recreate
deleted resources.

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

Migration 0022 idempotently expands legacy `translation_jobs.chunks_json` arrays into chunk rows. Migration 0032 closed the expand/contract window by dropping the column; all reads and writes target `translation_job_chunks`.

The active-job column intentionally has no foreign key. Translation jobs already cascade when a chapter is deleted, while avoiding a circular foreign-key lifecycle lets the transaction clear ownership before or while terminalizing a job.

Reader bookmark spot uniqueness is enforced by `reader_bookmarks_spot_uidx` over user,
chapter, paragraph, and `coalesce(source_column, '')`. Migration preflight refuses existing
duplicates with a nonzero exit code before applying migrations; it never deletes or merges
bookmarks. The unique index is the race-safe backstop, not permission to discard notes.
Release operators must back up the database, stop writers in maintenance mode, and keep
maintenance until migration and the matching deployment succeed. A duplicate preflight
failure aborts the release; restore service with the existing app/schema and resolve the
data deliberately before retrying. See README deployment migrations for the release boundary.

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
- Glossary finding terms retain the full imported values; the report schema does not impose a separate 500-character limit. Excerpt limits remain independent.
- Owner-only summaries omit raw JSON; detail responses return 10/25/50 rows. Review URLs preserve report/filter/page across reader edits and browser Back. Guest pages never request review data.

## Reader state

Signed-in reading position, read chapters, and bookmarks live in `reader_progress`, `reader_chapter_reads`, and `reader_bookmarks`, one row set per user and novel, and are read through `getReaderNovelState`. The route loader prefetches `["readerState", novelId]` for signed-in readers so the restore path reads it synchronously; guests read the `pnt-reader-progress` and `pnt-reader-bookmarks` browser stores instead and never issue the request. The two sources are intentionally not merged.

Client writes go through one store per `(novel, user)`: writes are serialized in order, and throttled scroll samples flush at most every 4 s or 2% of the chapter, with an immediate flush on chapter change and unmount; an unload-time flush is skipped because the browser aborts that request. The SQL guards above make out-of-order arrivals harmless. Scroll samples never enter the React snapshot, so reading does not re-render the chapter. Bookmarks store a paragraph index plus an excerpt; navigation re-locates the excerpt in the target chapter (falling back to the stored index) so re-translation and edits do not break them. One bookmark exists per paragraph and column: re-bookmarking a spot returns the existing row rather than inserting a twin, and the client drops its optimistic entry when the server reports the duplicate. In-chapter search, typography controls, and reader page themes are client-only and do not persist beyond `pnt-reader-settings`.

Account bookmarks use 200-row keyset pages ordered by `(created_at DESC, id DESC)` across
the novel, not a 200-bookmark storage quota. `getReaderNovelState` returns the first page
and `bookmarkNextCursor`; `getReaderBookmarks` returns subsequent pages. The opaque cursor
retains exact database timestamp text plus ID, so ties and deletion of its original row do
not break continuation. Creation is atomic under the novel/chapter locks and uniqueness
constraint; duplicates return the existing ID without replacing its note or excerpt.
The paging index includes `(user_id, novel_id, created_at, id)`, including the tie-breaker.
Migration 0035 corrects that index forward-only; previously applied 0033/0034 are preserved.

Loaded pages append into the existing reader-state Query cache, with stale responses
discarded after an intervening cache update. An authoritative refetch resets the collection
to the first page and its cursor. The dialog keeps loaded rows on paging failure and offers
retry; **Load more**, `N loaded`, and `N+` distinguish a partial list from a complete count.
Continuation remains available after all loaded bookmarks are removed. Paging loading/error
state is scoped to the current reader identity, so requests from an old novel/account cannot
block or surface errors in its replacement.
Guest bookmarks remain browser-local and do not use account paging.

## Export streaming

Owned TXT/EPUB exports select nonblank retained translations independently of publication
or current job status, ordered by the qualified numeric chapter column with `.cursor(1)`.
`HEAD` checks novel ownership and translation existence only; it never opens the body cursor.
Pull-based production consumes at most one chapter per production step and respects the
64 KiB byte-queue high-water mark. This is not a hard total-memory cap: a chapter's output,
ZIP finalization output, and compact EPUB title metadata can exceed it; chapter bodies do
not accumulate for the whole novel.

EPUB writes chapter entries first and derives nav/OPF/spine from the chapters actually
consumed, then finalizes the ZIP. The earlier existence check is not a database snapshot:
if all eligible chapters disappear before cursor iteration, a valid empty EPUB is allowed.
Cancellation stops production, closes iteration, and terminates compression. Iteration or
compression failures remain stream errors rather than successful truncated archives.

## Provider transport and upload admission

Both OpenAI and Gemini use the server-only provider network boundary and a shared Undici
Agent. Default endpoints are public HTTPS; local/private endpoints require administrator
opt-in through exact canonical `LOCAL_PROVIDER_ORIGINS`. All DNS answers are validated and
pinned for each new socket while original Host/SNI and TLS verification are retained.
Exceptions do not authorize other origins, redirects, URL credentials, or TLS bypasses.
Gemini uses `v1beta` `generateContent` REST under the configured base path, with API-key
header authentication; no thinking configuration is synthesized and thought parts are
excluded from visible text. Provider errors expose fixed messages rather than upstream bodies.
HTTP 401 reports invalid credentials; HTTP 403 reports provider access denied and prompts
checking account/model permissions and deployment IP restrictions rather than assuming a bad key.

EPUB admission allows two retained uploading/queued/staged resources per account and
100 MiB declared raw reservation. Uploading/queued rows reserve file size; staged rows
release raw reservation only with transactional raw-chunk removal but retain their slot.
Files remain limited to 50 MiB and 1 MiB chunks. Uploading expiry uses database time plus
24 hours; expired undeleted rows still count. Abort/reaping rechecks uploading state under
the novel gate, so queued/staged work is not removed by stale cleanup candidates. These
quotas are atomic and never fail open, but do not bound expanded archive/request memory.
Account create/chunk rate limits are 6/120 per minute and remain availability-first on
limiter failure, unlike storage admission. Guest IP limits require explicit trusted proxy
hops (default zero); missing identity or limiter failure logs and allows. README and
`.env.example` describe deployment configuration.

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
- `reader/reader-state.service.ts` owns reader position, read-mark, and bookmark persistence and their ownership scoping; `reader/use-reader-state.ts` selects the account or browser store and serializes client writes.
- `scrape.ts` and `scrape/parsers.ts`: client-safe source metadata and pure HTML parsing; `scrape/network-policy.server.ts` exclusively owns DNS resolution and private-address rejection.
- Route-facing server functions authenticate and delegate state transitions; they do not implement worker validity rules.
- Inngest orchestrates retries and per-novel concurrency but is not the source of truth for job validity.

## Backward-compatibility verification

The dedicated compatibility suite must cover public job shapes, stale-worker rejection, terminal-job immutability, migration defaults, ordered batch results, matching-revision retries, and migration-level uniqueness/outbox constraints.

Database integration tests require `TEST_DATABASE_URL` and exercise legacy chunk backfill/idempotence, the migration's partial unique index, concurrent production enqueues, stale finalization, failed outbox recovery, and streamed export ownership/order/headers/bytes against an isolated PostgreSQL service. They must never fall back to the application database.

The browser compatibility gate is `bun run test:e2e`. Its supervisor refuses database names without the `_e2e` suffix, owns local app/PostgreSQL/Inngest/OpenAI-stub lifecycles, uses an installed Chrome or Edge through Playwright on Node, and proves login, create, translate, publish, logout, and guest-read behavior without route interception.

## Deferred cleanup

The `translation_jobs.chunks_json` contract migration (0032) has been applied. `epub_uploads` carries a partial `(expires_at) WHERE status = 'uploading'` index for the hourly expired-upload cleanup, and `translation_job_chunks_metrics_idx` is deliberately kept as the covering index for the dashboard token/latency aggregate. Scrape responses remain bounded to 5 MB while streaming. Future storage or delivery changes must preserve the invariants and compatibility gates above.
