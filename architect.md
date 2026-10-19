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
16. Guest novel and chapter reads apply live publication time and translated status. Nonblank translated content is a write-time invariant — `status = 'translated'` implies a nonblank body (finalization refuses blank output, edits reject blank input, backup validation asserts null-or-nonblank) — so read paths must not test `translated_content`. Ownership-checked admin reads remain independent of publication state; a live novel may have no guest-visible chapters.
17. New translation jobs persist provider/model/fast-model, source character count, and available input/output prices. Historical totals use stored prices; legacy rows are explicitly current-settings estimates or unpriced.
18. Job history and stats are retained reads, not activity sources. Active progress comes from the lean owned activity query; terminal transitions invalidate retained history/stats once.
19. Evaluation version 2 findings are bounded, immutable snapshot evidence with stable classifications, one-based paragraph locations when known, capped excerpts, and reader-anchor links. Corrections require a new report.
20. Reader manifests contain only navigation metadata. Full chapter bodies are loaded through the full chapter query, and reader anchors take precedence over saved scroll restoration.
21. Chapter deletion first acquires the owned novel gate, then observes and locks the pointed translation job before locking the chapter and revalidating the pointer. Active work is terminalized with an exact-generation cancellation outbox event before the chapter and cascaded job rows are deleted; matching reader positions are cleared in the same transaction.
22. Signed-in reader state is account-scoped and single-writer per `(user, novel)`. Opening a chapter preserves the stored fraction only for that chapter and resets it otherwise; a scroll sample for any other chapter is dropped rather than overwriting the newer position; read marks are idempotent. Guests keep the browser-local equivalent, and reader settings stay browser-local for everyone.
23. A server function is callable only while the browser graph imports its module. The compiler registers server functions the client build reaches, and every server-side call site resolves through that manifest, so a `createServerFn` that only server code references fails at runtime with `Server function info not found`. Server-only work called from server code — session lookups above all — is `createServerOnlyFn`, which is invoked directly and never consults the manifest.
24. Database rows hold storage keys, never object bytes. Cover keys embed an immutable unguessable segment, so replacing a cover writes a new URL instead of purging a CDN object; private-bucket objects are reachable only through signed URLs or authenticated app routes. Storage failures degrade a feature (a missing cache entry rebuilds, a deleted row's archive is reaped) but never fail open into a public read.
25. A notification row is the record and a realtime message is only a hint to refetch. Fan-out is idempotent through `unique(user_id, dedupe_key)`, a `chapter_published` row exists only while its chapter is live, and every notification write is best-effort: it may be lost, but it never fails the publish, comment, or decision that caused it.

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

## Chapter translation history

`chapters.translated_content` holds one generation; `chapter_translation_versions` holds the
trail. Every write that sets that column appends its row in the same transaction — a finished
run (`translation`, with the job id), a manual edit (`manual`), a glossary propagation
(`glossary`), a backup import (`import`), and a restore (`rollback`) — so the newest row is the
current text by construction and a crash can never leave a translation with no history. The
row is a snapshot (`content`, title, summary, `source_revision`, `generation`), never a
difference against a neighbour, which is why a version from an older source revision is still
restorable and is merely labelled as such.

Clearing text is the one write that appends nothing: a blank body is not a version, and
absence is not a claim about what the chapter holds. The rows survive a clear because nothing
deleting text touches them, so "delete all translations" remains recoverable. Chapter deletion
cascades the trail; the job id deliberately carries no foreign key, so pruned jobs do not take
history with them.

The way back is part of the chapter list, not only of the history screen: each chapter row
carries `hasHistory`, an `EXISTS` over the trail computed in the same read as the rows, so a
chapter holding no translation at all still offers its history. The dialog serves the cleared
state too — with no current text there is nothing to diff, so it shows the selected version's
paragraphs as what restoring would put back, labels the newest row as not current, and leaves
restore enabled.

Restoring takes the novel mutation gate and refuses while `active_translation_job_id` is set —
a rollback racing a translator would simply be overwritten by finalization. It replaces content
and title, clears the chapter summary and the novel's rolling summary (the same derived state a
manual edit clears), leaves publication alone, and appends a `rollback` row, so the restore is
itself undoable and restoring the text already held is a no-op rather than a new row. The
appending transaction trims each chapter to the newest twenty rows, so retention is a property
of the table rather than a sweep. History is owner-only: both reads and the restore filter on
the novel's `user_id`.

## Audience report

The owner's audience is a read model over rows the reader already writes: `reader_chapter_reads`
(a row per reader per chapter, written on first finish, with `read_at` fixed at that moment) and
`novel_follows`. Three rules decide every number, and each is deliberate. The owner is excluded
from every count, so a chapter does not report its first reader before anyone else opens it.
Only signed-in readers exist here at all — a guest leaves no row — so the report never
approximates them. And a read is a finish, not a view, so "reads" is chapters completed and
re-reads add nothing.

One novel is read at a time in a bounded number of indexed aggregate queries, never a
per-chapter round trip: totals, the follow counts, one grouped query per chapter, the stopping
points (each reader's highest finished chapter in the window), and the daily buckets.
`waitingFollowers` is computed against the newest live chapter, so with nothing published every
follower counts as waiting. Daily buckets are UTC `YYYY-MM-DD` taken from `read_at` itself rather
than cast through the database session's timezone, and the gaps are filled so a quiet day draws
as zero instead of disappearing. `reader_chapter_reads_novel_chapter_read_at_idx` is the index
those filters and groupings read.

The report is read in one of four ranges — 7, 30 or 90 days, or all time — and the range is a
server-side window, not a filter over a larger answer: distinct readers in a week cannot be
recovered from a month's totals. Every figure derived from a read follows it: readers, finishes,
the per-chapter counts, the stopping points and the curve. `followers`, `waitingFollowers`,
`novels` and `publishedNovels` do not, because they describe a state rather than a period, and
the screen says so. A fixed range draws exactly its own days, ending today; all time has no
boundary and derives its bucket count from the first day that holds a read, so a lifetime curve
costs no extra query. `hasAnyReads` is read unfiltered in the totals query, which is what lets a
quiet week stay a report — zeros under a range selector — instead of being mistaken for a novel
nobody has ever read. The query key carries the range, so two windows are two cached answers and
switching back is free.

The account rollup (`getAccountAudienceForUser`) widens the same rules to every novel the
session owns, and the difference is exactly where a sum would be wrong: readers are distinct
across the account, because one reader of three novels is one reader; reads, followers and
waiting are summed, because each belongs to one novel; and waiting is still computed per novel
against that novel's newest live chapter, so a follower caught up on one story is still waiting
on another. Its range is the same window applied to the same figures, on the totals, each
novel's row and the curve, while the novel and follower counts stay current. Every owned novel
keeps a row, zero figures included — "followed but unread" is the question the screen exists to
answer — and each row links to the per-novel report it was computed from, so a figure can be
checked at the depth it came from. The read takes the range and the session, never novel ids: the
only ones in the query are the ones the server looked up for that account.

## Notifications

Following is a reader relation — an account plus a novel it may merely be reading, so the write gate is read visibility, not ownership — and the bell reads `notifications` newest-first with an unread count. The writers are: a live chapter fanning out to its novel's followers excluding the author; a top-level comment telling the novel's owner; a reply telling its parent's author; a new review telling the novel's owner; and a decided report telling each reporter whose claim was in the case. A comment and a reply on the same comment therefore reach different accounts, and a review's dedupe key is the review, so an edit notifies nobody. A single-chapter publish fans out inline after its transaction commits, because that is the one chapter an author is watching land; a bulk release and a scheduled chapter are left to a one-minute sweep, which makes the same idempotent write. Either path produces the row once.

Rows are snapshots: every target column is nullable and cleared on delete, while the title and excerpt stay, so the bell never depends on a join to content that may be gone. Unpublishing reconciles backward by deleting the chapter's rows, which keeps the invariant above true and lets a republished chapter notify again. Retention prunes read rows after 90 days and unread rows after 180.

Ably publishes one message per recipient on `notifications:<userId>`, batched at 100 channels per request, and a browser token is minted per session for `subscribe` on that one channel only. Delivery is deliberately not on the correctness path: the client refetches the notification query on every message and polls every 30 seconds, so an unset `ABLY_API_KEY` disables the socket and nothing else.

## Catalog directory

`listNovels` is the catalog's one read path, for the shared catalog and the account's own
shelf alike, and it is paged: a request names a scope, a page and the filters, and the
answer is at most `CATALOG_PAGE_SIZE` rows plus the filtered `total`. Three rules hold it
together. Visibility is `novelLive()` for the public scope and the viewer's own id for
`mine` — never the presence of a session, and never a client-supplied flag; the publication
filter exists only inside `mine`. Every piece of per-row work is bounded by the page:
chapter counts and tags are read for the returned ids, so a request costs the same at thirty
novels and at thirty thousand. Ordering is total, because every sort ends in `id`; a page
boundary can neither repeat nor skip a row when two novels share a timestamp.

Search is `ilike` over `lower(title || ' ' || original_title || ' ' || author)` with a
`pg_trgm` GIN index over the same expression (`novels_search_trgm_idx`), and `%` and `_` in
a term are escaped rather than refused. It is deliberately not `to_tsvector`: the default
text-search parser does not segment Thai or Chinese, so `to_tsvector('simple', 'สนุกมาก')`
is one lexeme and a search for `สนุก` would find nothing. The old copy was the opposite
error — an unbounded select, with the filters and the sort applied in the browser.

`novels.author` remains the publisher's text; `novel_authors` is the identity behind it,
resolved from that text on every save under a fold both the application and the backfill
migration can reproduce (`trim`, collapse whitespace, lowercase) and unique on it, so a
concurrent save cannot create a second row. Migration 0048 backfills the existing distinct
names. The catalog groups and links by `author_id`; an author page is the catalog with that
one filter applied, never a second query path, and an operator merge repoints novels,
rewrites their `author` text to the surviving spelling, deletes the duplicate row, and is
appended to `admin_audit_log` as `author.merged`.

Tags are a vocabulary (`tags`, unique Unicode-preserving `slug`) applied through
`novel_tags`, at most five per novel, and written as a set: the request says what the novel
should carry and one transaction converges to it under the novel row's lock. Only live
novels' tags reach the filter row, so the filter can never advertise a tag whose only
novels a guest cannot open.

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

## Object storage

Covers, EPUB upload archives, and cached exports live in object storage, not in Postgres.
`novels.cover_key` holds a key prefix (`covers/<novelId>/<segment>`), `epub_uploads.object_key`
holds one archive key, and the bytea `cover` column plus the `epub_upload_chunks` staging table
are gone (migration 0038). Keys are built only through `storage/keys.ts`: cover prefixes carry a
fresh random segment per upload, so the bytes behind any URL are immutable and the CDN may keep
them indefinitely, while publication state still gates whether a cover URL is exposed at all —
draft and scheduled covers resolve to null and fall back to the ownership-checked
`/api/covers/:novelId` route.

Its builders return branded `ObjectKey` and `KeySetPrefix` values rather than plain strings, and
the two brands are distinct, so a plain string cannot be passed to a bucket at compile time and a
set cannot be handed to a method that wants one object. That is the compile-time half of the same
rule the port enforces at runtime: a key is either produced by a builder or read back out of the
string it arrived as (`parseObjectKey`, `isObjectKeyPrefix`), and the only way past the type is a
cast that says so.

A prefix names a _key set_ — `covers/<novelId>/<segment>` for one uploaded cover,
`covers/<novelId>` for every cover of a novel, `avatars/<userId>/<segment>` for one photo —
and a listing or a prefix delete works on that set's own keys alone. `keySetScope` is the one
reading of a prefix: it resolves a set once, into the name a row stores (`name`, which a
directory is also named) and the boundary a store that matches raw string prefixes works on,
so a caller never writes a separator itself and a set can never reach a sibling that
merely shares its characters — listing `avatars` cannot return `avatars-archive/...`, and one
novel's prefix cannot reach a longer id that starts with it.

That resolution happens in `port.ts`, not in an adapter. An adapter receives an
`ObjectStorageBackend` contract: objects by key, and sets as an already-resolved
`KeySetScope`, whose two fields it reads as its transport requires — the filesystem names the
directory `name`, R2 lists or batch-deletes `boundary`. No adapter is handed a prefix, so a
third one cannot read a set differently from the other two, which is the drift this shape
removes: the same derived prefix could previously mean one set on the filesystem and another
on R2.

Two rules decide what a bucket stops holding, and both run in the same daily sweep
(`src/lib/account/purge.server.ts`). Deleting an account cascades its rows away without reaching
storage, so `pruneOrphanNovelAssets` removes what a novel that is gone owned: its cover sets and its
export cache, by prefix. A _surviving_ owner leaves residue its own row stopped naming, which
`reapSupersededAssets` removes: the cover segment a replacement superseded (a novel names one
segment, so every other one under its prefix is residue), the cached export revision the content has
moved past, and the staged archive no upload row names. What makes that second rule safe to run
unattended is age rather than a second read: an object's owner is always written _last_ — a cover row
names a segment only once that segment's objects exist, an export is spooled as the download that
produced it finishes — so a listing that reports when each object was written (`listObjects`, from
R2's `LastModified` and the filesystem's `mtime`) lets the sweep require a set's newest object to be
older than `SUPERSEDED_GRACE_MS` before it may call the set abandoned. A staged archive is removed by
key rather than by prefix, because its key _is_ its set. And which export revision is current is not a
second rule either: `exportCacheKey` assembles the fingerprint the route writes under — the one place
the inputs are named — so the route, the reaper and `storage:audit` cannot disagree about what is
still reachable.

One consequence is worth stating for the test runs: a set a run creates is exactly the kind the daily
sweep only reaches after its grace period — its row died with the database the run dropped — while the
buckets it wrote to are the application's own. A test run is made of exactly those sets — it migrates a
database it drops, and a staged archive that fails verification is deliberate in the suites that
assert the failure — so both runs measure the buckets before they start and remove the sets they
created once they have finished, one object at a time through the port (`scripts/bucket-footprint.ts`).
Objects are removed by key rather than by prefix, because a staged archive is a single object whose key
_is_ its set and a prefix delete of it has nothing to sweep — the filesystem adapter would remove the
file, a boundary listing in the bucket would match nothing. A container set goes the same way, one
object at a time; every key in it is new by the rule that made the set the run's, so removing them all
removes the set. A set that already held an object, and a key no rule reads, are reported and left
alone: with the buckets shared with the application, only what the run itself wrote may be removed, and
only inside its own window — the integration run takes it around the whole Vitest run rather than
around each suite, since the suites run at the same time.

The same `port.ts` refuses what the vocabulary does not derive, at the one place an adapter is
chosen, so a `put`, `get`, `head`, `delete`, `presignPut`, `listKeys` or `deletePrefix` naming
a path no builder produces rejects before the adapter is touched, and a hand-built key cannot
reach a bucket even if a caller tries. The declared types carry that rule as well — the port and
the `ObjectStorageBackend` beneath it are both keyed with the branded values — so the runtime check
is what remains for a value that bypassed the type: a row, a listing, a request parameter, or a
caller outside this application's TypeScript. Refusals reject rather than throw, because the callers
that tolerate a missing object attach `.catch(...)` and a synchronous throw would escape it.
`publicUrl` is deliberately outside the guard: it reaches no bucket, and the pages that call
it resolve a key stored on a row, so a malformed row degrades to a missing image instead of
failing the whole render.

Caching is a property of the delivery path, not of a write. The app never sets a per-object
`Cache-Control`, and the storage port has no option to: cover variants are kept by a long-lived
immutable rule on the public bucket's custom domain, which makes the same guarantee for objects
written by any code path. Adding an immutable-looking header here would let a written object and
a cached one disagree. `r2.server.ts` talks to R2 through `s3mini` over the bucket-scoped S3
endpoint, with the client's `fetch` pinned explicitly: the library would otherwise switch to
Bun's native `Bun.S3Client` for reads, listings, deletes and presigning on a Bun runtime, and
development would then exercise a different implementation than the Node deployment.

Two buckets separate exposure: `public` serves only live cover variants from the CDN origin and
always names a `publicUrl`; `private` holds upload archives and cached exports and reports a null
`publicUrl`, which is the signal to serve through the application instead of handing out a link.
Cover uploads are validated and re-encoded into WebP variants (320/480/640) plus a retained
original, so a later variant can be derived without the source upload; deleting a novel's cover
deletes the whole prefix, and a missing prefix is a no-op.

Profile photos are the one public-bucket object that is not a novel's cover. `user.image` holds a key
prefix (`avatars/<userId>/<segment>`), built through the same helpers and with the same unguessable
segment, because guests will see these photos beside comments and author bylines. An upload writes
square WebP variants (64/128/256) plus a retained original before the row is updated, so a profile
never points at missing bytes and a replaced photo is a new URL rather than a purge. Where the bucket
reports no public origin, the resolver falls back to `/api/avatars/<userId>/<segment>?w=`, whose path
repeats the segment so even that response is immutable. The stored key never reaches a client: the
viewer resolver exchanges it for URLs, and `user.image` is read only through
`profile/service.server.ts`.

EPUB uploads are written straight to the private bucket by the browser through a presigned PUT
for exactly one key and a bounded expiry; the app verifies existence with a metadata `HEAD` rather
than downloading the object, and the worker reads the archive once to combine and import it. Export
caching is a best-effort tee: the generated response streams to the client exactly as before and is
spooled to the private bucket only while it stays under the in-memory cap, so bounded memory never
depends on the cache. Cache identity is a content fingerprint over format, title, author, target
language, chapter count, newest chapter update, and highest translation generation; cover or
publication-only edits deliberately do not invalidate it, and bumping `EXPORT_FORMAT_VERSION`
invalidates everything. Storage write failures are swallowed for caches and reaped objects, because
the user-visible operation already succeeded.

When the six `R2_*` variables are unset, `index.server.ts` selects a filesystem adapter rooted at
`.tura/storage/`; `env.ts` enforces all-or-nothing configuration and requires the full set on
Vercel. That adapter reports a null `publicUrl` for both buckets and presigns PUTs back to a
dev-only receiver route, so the production upload path is exercised without a bucket. Migration
0037 folds keys staged by `bun run storage:migrate` into `cover_key`; that script must run before
`db:migrate` on any database still holding legacy cover bytes, and `scripts/migrate.ts` refuses to
apply 0038 while unmapped covers or keyless upload rows remain.

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
- `auth/functions.ts`: `getSession`, `ensureSession`, and `ensureAdminSession` are server-only functions consumed by route handlers and other server functions, so they carry no RPC identity; `getAuthMethods` stays a server function because the sign-in pages fetch it from the browser.
- Inngest orchestrates retries and per-novel concurrency but is not the source of truth for job validity.

## Backward-compatibility verification

The dedicated compatibility suite must cover public job shapes, stale-worker rejection, terminal-job immutability, migration defaults, ordered batch results, matching-revision retries, and migration-level uniqueness/outbox constraints.

Database integration tests require `TEST_DATABASE_URL` and exercise legacy chunk backfill/idempotence, the migration's partial unique index, concurrent production enqueues, stale finalization, failed outbox recovery, and streamed export ownership/order/headers/bytes against an isolated PostgreSQL service. They must never fall back to the application database.

The browser compatibility gate is `bun run test:e2e`. Its supervisor refuses database names without the `_e2e` suffix, owns local app/PostgreSQL/Inngest/OpenAI-stub lifecycles, uses an installed Chrome or Edge through Playwright on Node, and proves login, create, translate, publish, logout, and guest-read behavior without route interception.

## Deferred cleanup

The `translation_jobs.chunks_json` contract migration (0032) has been applied. `epub_uploads` carries a partial `(expires_at) WHERE status = 'uploading'` index for the hourly expired-upload cleanup, and `translation_job_chunks_metrics_idx` is deliberately kept as the covering index for the dashboard token/latency aggregate. Scrape responses remain bounded to 5 MB while streaming.

The object-storage move (0037 map fold plus 0038 contract) has also been applied: `novels.cover`
and `epub_upload_chunks` are gone and `epub_uploads.object_key` is required. Re-run order for any
lagging environment is `bun run storage:migrate` then `bun run db:migrate`; the migration runner's
preflight enforces it. Future storage or delivery changes must preserve the invariants and
compatibility gates above.
