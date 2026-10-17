# Personal Novel Translator

A novel translation app (EN→TH default, ZH→EN, ZH→TH) with public accounts and guest read-only access. Paste or scrape chapters, translate with an OpenAI-compatible provider or Gemini, and read side-by-side with Thai font support. Every account owns an isolated workspace; an optional operator role unlocks account administration.

<details>
<summary>Preview</summary>

<img width="1904" height="1016" alt="Library" src="https://github.com/user-attachments/assets/e6773d64-f4ea-47ff-9d4c-01c389125374" />
<img width="1904" height="1016" alt="Novel Detail" src="https://github.com/user-attachments/assets/8f2373f9-d7b1-4d67-8eba-b010b09fa124" />
<img width="1904" height="1016" alt="Reader" src="https://github.com/user-attachments/assets/5f93259b-5e6d-466c-9c63-397a5a13600c" />
<img width="1904" height="1016" alt="Dark Mode" src="https://github.com/user-attachments/assets/74e4942b-2db2-46c3-88e0-210be0843012" />

</details>

## Features

- **Novel library** — gallery grid with cover uploads (validated, re-encoded to WebP variants, and served from object storage), language pair display, and translation progress
- **Chapter CRUD** — paste raw text or bulk-import from supported sites (`quanben.io`, `twkan.com`, `biquge.tw`); decimal numbering for re-ordering
- **Inngest-driven translation** — serverless-safe, chunked at paragraph boundaries, resumable, cancellable, per-chunk retry
- **Consistency engine** — per-novel glossary (approved terms injected per chunk) + rolling chapter summaries for stable names/tone
- **Reader** — side-by-side raw/translated, paragraph-aligned synced scroll, font size/typeface controls, chapter editing and translation from the reader actions menu
- **Translation review** — admin-only script, paragraph-count, and approved-glossary checks with per-chapter findings. Check `first3`, `all`, or decimal ranges such as `1,1.5,5-8`; open a chapter to edit, then run a new check. Reports remain immutable snapshots, mark changed/deleted chapters, and explicitly skip untranslated content. These heuristics do not verify translation accuracy.
- **Guest access** — published content visible to anyone; scheduled publishing (`publishedAt` null/draft/future); best-effort rate-limited reads when trusted ingress is configured
- **Accounts** — public sign-up with optional OAuth (Google/Discord), email verification and password reset through Resend, optional Cloudflare Turnstile, profile photo/name, linked sign-in methods, active-session management, and self-service account deletion
- **Shared catalog** — `/browse` lists every published novel from every account; a signed-in reader gets per-account bookmarks, progress, and read marks on novels they do not own
- **Operator screen** — `/admin` (admin role only) lists accounts with search and paging, and can grant or revoke operator access, suspend or restore an account, and delete one. The seeded account from `bun run seed:user` is the only source of the admin role
- **Chapter discussion** — every published chapter carries a discussion: readers comment and reply one level deep, edit or delete their own words, and report anything that breaks the rules. Guests read it; writing needs an account, a published chapter, and a per-account rate limit. An author's deletion leaves a tombstone while replies exist, and an operator's removal leaves the author a reason
- **Ratings & reviews** — signed-in readers give a novel 1–5 stars with an optional written review, one per account per novel, editable and removable. The novel page shows the average, the count, and the 5-to-1 distribution; the header shows the score beside the title. Authors rate other people's novels, never their own
- **Member reporting** — a signed-in reader can report a published novel they don't own, a chapter comment, or a review (copyright, sexual content, sexual cover, hate or harassment, spam, or something else) with an optional explanation. Operators work the reports as one case per target on `/admin/reports`, decide each case with a note, and see every decision in the activity trail. A decision records; it does not suspend an account or take content down on its own. For a comment or review the case also offers a separate **Remove content** action — deleted for everyone but its author — recorded as its own audited action
- **Dark mode** — app-wide via `next-themes`, warm charcoal surfaces
- **Export** — chapter/novel to `.txt` or `.epub`
- **Batch translate** — multi-select chapters, queued sequentially

## Tech Stack

TanStack Start (React 19, Vite) + Router + Query · Tailwind v4 (CSS-first `@theme`) · shadcn/ui on Base UI · Drizzle ORM + PostgreSQL (`postgres` driver) · Cloudflare R2 object storage (S3 API via `s3mini`) · Better Auth · Inngest (durable translation steps) · `openai` SDK + Gemini REST over controlled Undici transport · oxlint/oxfmt · Vitest · Nitro (Vercel deploy)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/)
- A PostgreSQL database

### Setup

```bash
# Install dependencies
bun install

# Copy env template and fill in values
cp .env.example .env.local

# Generate secrets
bun -e "console.log(crypto.getRandomValues(new Uint8Array(32)).toBase64())"  # BETTER_AUTH_SECRET + APP_ENCRYPTION_KEY

# Run database migrations
bun run db:migrate

# Create and migrate the isolated integration-test database (TEST_DATABASE_URL)
bun run db:migrate:test

# Seed the operator account, the only source of the admin role
# (requires SEED_ADMIN_* in .env.local)
bun run seed:user

# Start dev server (port 3000)
bun dev

# Start Inngest dev server in another terminal (for translation & bulk import)
bun run inngest
```

### Commands

| Task                   | Command                                      |
| ---------------------- | -------------------------------------------- |
| Dev server             | `bun dev`                                    |
| Inngest dev            | `bun run inngest`                            |
| Production build       | `bun run build`                              |
| Lint / fix             | `bun run lint` / `bun run lint:fix`          |
| Format / check         | `bun run format` / `bun run format:check`    |
| Tests                  | `bun run test`                               |
| PostgreSQL invariants  | `bun run test:integration`                   |
| Browser workflow       | `bun run test:e2e`                           |
| Release audit          | `bun run audit:release`                      |
| DB generate / migrate  | `bun run db:generate` / `bun run db:migrate` |
| Move covers to storage | `bun run storage:migrate`                    |
| Prune orphan avatars   | `bun run storage:prune-avatars`              |
| Audit bucket ownership | `bun run storage:audit`                      |
| Migrate test database  | `bun run db:migrate:test`                    |
| Seed operator account  | `bun run seed:user`                          |
| Regenerate route tree  | `bun run generate-routes`                    |

### Deployment migrations

Database migrations are a release step, not a Vercel build step. For a production release,
take a database backup and stop application/worker writers in maintenance mode before an
operator runs `bun run db:migrate` against the intended target. Keep maintenance in place
until both the migration and matching application deployment succeed. Vercel builds use the
locked dependency graph and do not mutate database state. Verify migrations on the isolated
test database first; never use application data as a migration test fixture.

The migration runner aborts with a nonzero exit code if existing reader bookmarks duplicate
the same user/chapter/paragraph/column spot (including a null column). It does not delete or
merge bookmarks or choose which note to retain. If this preflight fails, abort the release;
leave the existing application/schema in service after lifting maintenance and resolve the
duplicates through a deliberate, data-preserving operator decision before retrying. The
unique index remains the final backstop if a write races preflight; do not bypass the guard.

Migration 0038 is the contract half of the object-storage move: it drops `novels.cover`,
drops `epub_upload_chunks`, and makes `epub_uploads.object_key` required. For any database
that already holds cover bytes, the expand half is 0037, which folds in keys staged by
`bun run storage:migrate`. That means the release order is explicitly
`bun run storage:migrate` **before** `bun run db:migrate`. The storage script uploads each
legacy cover to object storage and records one row per novel in a temporary
`r2_migration_covers` map; 0037 copies those keys into `cover_key` and drops the map, 0038
then drops the bytea column. `bun run storage:migrate --dry-run` reports what would move
without writing anything, and the script refuses to finish while any cover is unmapped or
any EPUB upload is queued or staged, so no archive is lost to an ordering mistake. The
migration runner performs the same preflight and aborts with a nonzero exit code when
unmigrated covers or keyless upload rows remain.

Avatars need no equivalent release step, because replacing a photo already deletes the set
it replaced. What can still strand a set is a path that stops short of the row write: a user
row removed, or a failed write-back. `bun run storage:prune-avatars` lists the public
bucket, diffs it against the `image` of every user, and deletes the avatar sets nothing
points at; `--dry-run` prints the same plan and deletes nothing. It refuses to act when the
bucket cannot be listed rather than reading a failed listing as an empty one, ignores every
key that is not a whole `avatars/<userId>/<segment>` set, and re-reads the referenced keys
just before deleting so a set that an upload referenced while the listing was in flight is
kept. Run it while the app is idle: an upload writes its objects before its row, so a sweep
crossing that window cannot tell a fresh set from an abandoned one.

Everything else the buckets accumulate belongs to the daily storage sweep, which answers two
questions. A novel that is gone leaves sets no row owns, and the sweep prunes those by prefix. A
novel that survives leaves sets its row stopped naming — the cover segment a replacement superseded,
the cached export revision the content moved past, the staged archive a cleaned-up upload row left
behind — which no row can ever name again, and those are reaped one set or one object at a time. Age
is what makes the second rule safe to run unattended: every writer here puts its objects down before
the row that names them, so the sweep only removes a set whose newest object is older than a day,
which no cover replacement, export in flight, or presigned upload can be. A bucket that cannot be
listed aborts the run rather than being read as empty, and one object that cannot be removed is
reported rather than aborting the rest.

What is left in the buckets is what `bun run storage:audit` reports. It lists the whole public and
private buckets rather than the roots the sweeps scan, asks the same ownership rule they ask, and
prints every set no row names — with why no row names it (the row is gone, or it survives and has
moved on) and the sweep that removes it — plus a key whose shape the app never wrote and a key whose
kind belongs in the other bucket. An export revision counts as named only when it is the key the
route would compute right now, which is the same revision rule the sweep reaps by, so the report
cannot disagree with the sweep about which revision is current. It is read-only by construction — a
test holds it to never deleting — and exits 0 whether or not it finds anything, because it is a
report rather than a gate. Point `DATABASE_URL` at the database the bucket belongs to: the rows and
the revision rule are what decide ownership, so a mismatched database makes every set look unowned.

The release audit fails on moderate, high, or critical advisories. Direct dependencies and
tooling are exact-pinned; targeted overrides keep legacy tool paths on patched `esbuild`,
`gaxios`, and `adm-zip` releases. Validate reproducibility with `bun install --frozen-lockfile`.

## Environment Variables

| Variable                        | Required | Description                                                                                        |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | Yes      | PostgreSQL TCP connection string                                                                   |
| `TEST_DATABASE_URL`             | No       | Isolated database for `bun run test:integration`                                                   |
| `BETTER_AUTH_SECRET`            | Yes      | 32-byte base64 random string                                                                       |
| `BETTER_AUTH_URL`               | Yes      | App base URL, no trailing slash (e.g. `http://localhost:3000`)                                     |
| `APP_ENCRYPTION_KEY`            | Yes      | 32-byte base64 random string for encrypting API keys at rest                                       |
| `LOCAL_PROVIDER_ORIGINS`        | No       | JSON array of exact canonical HTTP(S) origins allowed to use local/private addresses; default `[]` |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS` | No       | Nonnegative trusted `X-Forwarded-For` hop count; default `0` trusts no client IP headers           |
| `SEED_ADMIN_EMAIL`              | No       | Operator email for `bun run seed:user`                                                             |
| `SEED_ADMIN_NAME`               | No       | Operator display name                                                                              |
| `SEED_ADMIN_PASSWORD`           | No       | Operator password                                                                                  |
| `RESEND_API_KEY`                | No       | Resend API key for verification, reset, email-change, and deletion mail                            |
| `EMAIL_FROM`                    | No       | Verified Resend sender, e.g. `Pnt <no-reply@example.com>`                                          |
| `TURNSTILE_SITE_KEY`            | No       | Cloudflare Turnstile site key (public); the captcha registers only with the secret below           |
| `TURNSTILE_SECRET_KEY`          | No       | Cloudflare Turnstile secret key; presence enables the captcha on sign-up, sign-in, and reset       |
| `GOOGLE_CLIENT_ID`              | No       | Google OAuth client ID; offered only when both halves are set                                      |
| `GOOGLE_CLIENT_SECRET`          | No       | Google OAuth client secret                                                                         |
| `DISCORD_CLIENT_ID`             | No       | Discord OAuth client ID; offered only when both halves are set                                     |
| `DISCORD_CLIENT_SECRET`         | No       | Discord OAuth client secret                                                                        |
| `VERCEL_URL`                    | No       | Set by Vercel; trusted as an auth origin so preview deployments can sign in                        |
| `VERCEL_BRANCH_URL`             | No       | Set by Vercel; trusted as an auth origin so branch deployments can sign in                         |
| `INNGEST_DEV`                   | No       | Set to `1` for local dev (SDK v4 defaults to cloud mode)                                           |
| `INNGEST_EVENT_KEY`             | No       | Inngest Cloud event key (production only)                                                          |
| `INNGEST_SIGNING_KEY`           | No       | Inngest Cloud signing key (production only)                                                        |
| `SCRAPER_API_KEY`               | No       | ZenRows API key for bypassing Cloudflare anti-bot                                                  |
| `SCRAPER_BASE`                  | No       | ZenRows API base URL (default `https://api.zenrows.com/v1/`)                                       |
| `SCRAPER_RENDER_JS`             | No       | Set `"true"`/`"false"` for headless browser rendering                                              |
| `SCRAPER_PREMIUM_PROXY`         | No       | Set `"true"`/`"false"` for residential proxy routing                                               |
| `SCRAPINGBEE_API_KEY`           | No       | ScrapingBee API key for HTML scraping provider                                                     |
| `FIRECRAWL_API_KEY`             | No       | Firecrawl API key for scrape endpoint                                                              |
| `VITE_PUBLIC_POSTHOG_KEY`       | No       | PostHog project API key for frontend analytics                                                     |
| `VITE_PUBLIC_POSTHOG_HOST`      | No       | PostHog API host (default `https://us.i.posthog.com`)                                              |
| `R2_ACCOUNT_ID`                 | Prod     | Cloudflare account ID owning the R2 buckets                                                        |
| `R2_ACCESS_KEY_ID`              | Prod     | R2 S3-API access key ID                                                                            |
| `R2_SECRET_ACCESS_KEY`          | Prod     | R2 S3-API secret access key                                                                        |
| `R2_PUBLIC_BUCKET`              | Prod     | Bucket for published cover variants, served from the CDN origin                                    |
| `R2_PRIVATE_BUCKET`             | Prod     | Bucket for EPUB upload archives and cached exports; never publicly readable                        |
| `R2_PUBLIC_BASE_URL`            | Prod     | Canonical HTTPS origin of the public bucket's custom domain, no trailing slash                     |

### Accounts, roles, and email

Sign-up is public. Every account receives the `user` role and an isolated workspace, and
ownership — not identity — is what gates a novel, its chapters, its glossary, and its
reader state. The `admin` role is granted only out of band, either by `bun run seed:user`
or by an existing operator on `/admin`; nothing a client sends can produce it. Server
functions read the role from the session with `requireAdminSession`.

Email verification is offered at sign-up but not required to sign in: an unverified
address costs almost nothing here, while blocking sign-in behind mail deliverability would
strand people at the moment they are most likely to leave. Password reset, email change,
and account deletion all go through email, so configure Resend (`RESEND_API_KEY` and
`EMAIL_FROM`, both or neither) before offering this to real users. Without those values
the mailer logs the message instead of sending it — which is what lets local dev, CI, and
the E2E run finish a reset flow with no mail account — and the app logs a startup warning.

Cloudflare Turnstile and the OAuth providers are each registered only when their
credentials are present, so an unconfigured method is absent from the sign-in pages
rather than shown and then failing at the callback.

### Operator controls

`/admin` is the operator screen, in three tabs. **Accounts** lists every account with the
controls that apply to it: grant or remove operator access, suspend (with a reason the
account is shown at sign-in and a duration of 7, 30, or 90 days, or none for a
permanent suspension), restore, sign the account out of every device, view as the
account, and delete it. None of these will act on the acting operator's own account, and
operator accounts cannot be viewed as another account — so impersonation is never a step
toward taking over the deployment. **Reports** is the member-report queue, and
**Activity** is the durable record of those actions, read from `admin_audit_log` rather
than a process log that rotates away.

A report is a member's claim about a published novel, a chapter comment, or a novel
review: one of a fixed set of reasons with an optional explanation. The queue groups every
open report on the same target into one **case**, so an operator decides once and the
whole pile moves with that decision — a status of upheld or dismissed plus a note. Deciding
never suspends an account, unpublishes a novel, or deletes anything. For a comment or
review the case also offers a separate **Remove content** action, which needs a reason of
its own, takes the words down for everyone but their author, and is recorded as its own
audited action; the case stays open, because removing content and deciding the report are
two different things. Each decision appends to the activity trail, recording the account
the case was about and the target it named.

A case outlives the novel it is about. The reported title and its owner are snapshotted
onto each report, and `reports.novel_id` is cleared rather than cascaded when a novel is
deleted, so a case for deleted content is still readable, still closable, and still names
its owner in the trail. Filing is metered per account (10 an hour), and a partial unique
index allows one open report per account per novel — so a member cannot stack a case, and
can report a novel again only after the previous case was decided.

A suspension is stored as `banned`, `banReason`, and `banExpires`, and the auth plugin
enforces it when the account next creates a session — where it also clears a ban whose
expiry has passed. Because that clearing is lazy, the stored flag can outlive the ban
itself; the Accounts tab therefore reads its status from the expiry (`describeBan`) and
shows a lapsed ban as suspended-but-expired rather than repeating the stale flag. A
suspension ends the account's sessions and blocks sign-in; it does not unpublish the
account's novels, because it targets the account rather than the catalog.

**View as this account** opens a 30-minute session as that account, for reading. It is
read-only by construction: an impersonated session carries `impersonatedBy`, and
`requireSession` — which every mutation in the app authenticates through — refuses such a
session. Reads reach the session through `getSession` or `ensureSessionForRead` instead,
so the viewed account's library, job history, and reader state are all visible while
nothing can be changed. A banner on every page names both accounts and returns the
operator to their own session; if the operator's session cannot be restored, it says to
sign out and back in rather than trapping them in someone else's account.

Each account records the terms version in force when it was created. Bumping
`CURRENT_TERMS_VERSION` (in `src/lib/terms.ts`) makes the shell show a standing notice
to every account still recorded under an older version, and accepting it stamps the new
version from the server. It is a notice, not a gate: reading, browsing, and exports stay
available while it is showing.

### Provider connections

Provider endpoints must use HTTPS and resolve only to public addresses by default. Empty
base URLs select `https://api.openai.com/v1` for OpenAI or
`https://generativelanguage.googleapis.com` for Gemini. Gemini uses the `v1beta`
`generateContent` REST API beneath the configured base path, not the Google SDK; it does
not add a thinking configuration or include hidden thought parts in translation text.

For an intentionally local provider, an administrator can set, for example,
`LOCAL_PROVIDER_ORIGINS='["http://127.0.0.1:4010"]'`. Each entry must be exactly its
canonical origin: no trailing slash, path, credentials, query, fragment, or default-port
alias. Scheme and port are part of the exception; another origin does not inherit it.
Malformed configuration prevents startup. Exceptions relax only the public-address and
HTTPS requirements: TLS verification remains enabled, request origins remain fixed, and
all redirects are rejected. DNS answers are validated and pinned when opening a socket,
not only when settings are saved.

### Trusted ingress and upload admission

Set `RATE_LIMIT_TRUSTED_PROXY_HOPS` only behind a controlled proxy chain that prevents
direct access to the application and reliably appends client addresses. The limiter
selects the address that many hops from the right of `X-Forwarded-For`. With the default
`0`, or a missing/invalid/too-short chain, guest IP limiting is skipped and logged rather
than pooling readers into an unknown bucket. Guest read limits are availability-first:
limiter storage failures log and allow; a genuine quota excess returns HTTP 429.

EPUB admission permits at most two retained upload/import resource slots per account and
100 MiB of declared raw-file reservation, with a 50 MiB per-file limit and 1 MiB chunks.
Uploading, queued, and staged resources occupy slots; uploading and queued files reserve
their declared sizes. Staging releases raw reservation only when raw chunks are deleted
in the same transaction, but keeps the slot until resource cleanup. Uploading resources
expire after 24 hours by database time; expired rows still consume capacity until removed.
Abort an unfinished upload or wait for cleanup to release capacity. Admission is atomic
and never fails open; these limits do not bound expanded EPUB size or request buffering.
Create/chunk requests also have best-effort account limits of 6/120 per minute.

## Project Structure

```
src/
  routes/
  components/
  lib/
  styles/
e2e/
scripts/
drizzle/
```

The `postgres` driver keeps a single connection per application process, recycled after 60
seconds idle and 10 minutes total, and runs with `prepare: false` so it is safe behind a
transaction-mode pooler. Serverless instances scale out independently and each opens its own
pool, so the raw demand is `1 x active instances`: `DATABASE_URL` must be the provider's
**pooled** endpoint (on Neon, the host carrying the `-pooler` suffix), which multiplexes that
fan-out onto a small number of server connections. Without a pooler a modest `max_connections`
is exhausted during a traffic spike and queries are rejected with SQLSTATE 53300.

`DATABASE_URL_UNPOOLED` is the paired **direct** endpoint. Migrations and drizzle-kit use it
because DDL and prepared statements need a real session, which transaction pooling does not
guarantee; set it to the same value as `DATABASE_URL` when the deployment has no pooler.

`DATABASE_POOL_MAX` is optional and defaults to `1`; leave it unset in production, where one
connection per instance is the deliberate shape described above. The integration suites that
make two transactions contend for the same row lock raise it, because a single connection
serializes those requests client-side: Postgres then never sees the lock waiter they assert on.

## Persistence and delivery boundaries

- Translation job metadata lives in `translation_jobs`; ordered chunk source, progress, output,
  token counts, latency, and errors live in `translation_job_chunks`. Migration 0022 backfilled
  legacy `chunks_json` values idempotently, and migration 0032 dropped the column once the
  expand/contract window closed.
- Translation enqueue commits a durable `workflow_outbox` row in the same transaction as
  job state. Eager dispatch is best-effort, while the Inngest cron retries pending rows.
- Novel mutations take an ownership-checked novel-row gate before descendant locks/writes;
  multi-novel operations acquire every required novel in ascending ID order first. Provider
  I/O stays outside these transactions. See [architect.md](architect.md) for the protocol.
- Novel TXT and EPUB downloads use authenticated `/api/exports/:novelId` responses. Nonblank
  retained translations stream in numeric chapter order through `.cursor(1)`, independently
  of guest publication status. Pull-based production respects consumer backpressure;
  `HEAD` performs metadata/existence reads without opening a body cursor. EPUB navigation
  and spine describe only chapters actually consumed, not an earlier title manifest.
  The 64 KiB queue high-water mark is not a hard total-memory cap: an individual chapter's
  output and compact EPUB title metadata can exceed it. Cancellation closes iteration;
  producer failures remain stream errors, not successful truncated downloads.
- Account bookmarks load in 200-row keyset pages with explicit **Load more** and a partial
  count while more remain; 200 is not a storage quota. A reader-state refetch replaces
  accumulated pages with the first page and its continuation. Guests retain local storage.
- `src/lib/storage/` is the object-storage port. `keys.ts` is pure key/revision derivation,
  `r2.server.ts` speaks the R2 S3 API, `local.server.ts` is the filesystem adapter used when
  R2 is unconfigured, and `index.server.ts` selects between them. Covers are uploaded to the
  public bucket as per-width WebP variants under `covers/<novelId>/<unguessable segment>/`, so
  replacing a cover yields a fresh URL instead of a cache purge. EPUB upload archives and
  cached exports live in the private bucket and are reached only through signed URLs or the
  app's own routes. When R2 is absent the app boots against `.tura/storage/`, which keeps the
  upload code path identical (presigned PUTs point back at a dev-only receiver route) without
  a bucket. The `R2_*` variables are all-or-nothing, and Vercel requires all six.
- `src/lib/scrape/index.ts` is a client-safe facade over pure parsers. DNS resolution and private-IP
  rejection live in the server-only `src/lib/scrape/network-policy.server.ts` boundary.
- `reports` holds member claims, not verdicts: the open queue is grouped per target - a novel,
  a comment, or a review - in SQL and the decision is written across every open report of a case
  in one statement, so a retry cannot half-close a case and a second operator acting on the same
  case races to zero rows and is told it was already decided. `src/lib/reports/reasons.ts` is the
  one vocabulary the reporter's dialog and the operator queue both read. Operator removal of a
  comment or review is its own audited action in `src/lib/comments/` and `src/lib/reviews/`,
  never a side effect of a decision.

## Local verification

`bun run test` runs unit tests only. `bun run test:integration` reads the isolated
`TEST_DATABASE_URL` from `.env.local` — it must never be the application database — and
`bun run db:migrate:test` creates that database when missing and applies migrations to it. The
suites skip themselves when the variable is unset. `bun run test:e2e` owns a guarded `*_e2e`
database, app, Inngest dev server, and deterministic OpenAI-compatible stub, then drives login,
novel/chapter creation, translation, publication, logout, and guest reading in an installed Chrome
or Edge browser. Every child process is bounded and torn down on success or failure. Unit and
integration suites exercise object storage through the filesystem adapter under
`.tura/storage/`, so no bucket or credentials are needed to verify upload, variant, cleanup,
and streamed-export behavior locally.

## Docs

- [DESIGN.md](DESIGN.md) — Design system (colors, type, components, Do/Don'ts)
- [AGENTS.md](AGENTS.md) — Developer guide (commands, conventions, architecture notes)

## Deploy

### Vercel

Connect the repository in Vercel. If the project was previously configured with **Root Directory** `apps/web`, change it back to the repository root so Vercel uses the root `bun.lock` and `vercel.json`. Set all required environment variables. The Nitro adapter produces a self-contained Node server; the configured build also runs the postbuild function-duration patch.

### Cloudflare R2

Covers, EPUB upload archives, and cached exports live in object storage. Create two R2
buckets — one public (cover variants, fronted by a custom domain) and one private (upload
archives and exports) — then create an R2 API token with object read/write access and set the
six `R2_*` variables. `R2_PUBLIC_BASE_URL` must be the public bucket's custom domain as a
canonical HTTPS origin with no trailing slash; the app uses it to build cover URLs and falls
back to serving through its own proxy route when it is unset. Without the full set the app
boots against the local filesystem adapter, which is fine in development and on the CI runner
but not on Vercel, where all six are required.

Cover objects carry no `Cache-Control` header: caching is a rule on the public domain. Add a
Cloudflare Cache Rule for the cover path with a long edge TTL so the CDN keeps the variants,
which is safe because every upload writes a fresh unguessable key segment and the bytes at any
cover URL never change. EPUB archives and cached exports live behind the private bucket and are
never cached publicly.

### Inngest (production)

1. Create an Inngest Cloud account and app in the dashboard
2. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel env
3. Sync the app in the Inngest dashboard — the `/api/inngest` handler auto-registers the `translate-chapter` and `import-chapters` functions
