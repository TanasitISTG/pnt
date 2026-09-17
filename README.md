# Personal Novel Translator

A novel translation app (EN→TH default, ZH→EN, ZH→TH) with a single admin and guest read-only access. Paste or scrape chapters, translate with an OpenAI-compatible provider or Gemini, and read side-by-side with Thai font support.

<details>
<summary>Preview</summary>

<img width="1904" height="1016" alt="Library" src="https://github.com/user-attachments/assets/e6773d64-f4ea-47ff-9d4c-01c389125374" />
<img width="1904" height="1016" alt="Novel Detail" src="https://github.com/user-attachments/assets/8f2373f9-d7b1-4d67-8eba-b010b09fa124" />
<img width="1904" height="1016" alt="Reader" src="https://github.com/user-attachments/assets/5f93259b-5e6d-466c-9c63-397a5a13600c" />
<img width="1904" height="1016" alt="Dark Mode" src="https://github.com/user-attachments/assets/74e4942b-2db2-46c3-88e0-210be0843012" />

</details>

## Features

- **Novel library** — gallery grid with cover uploads (stored in Postgres), language pair display, and translation progress
- **Chapter CRUD** — paste raw text or bulk-import from supported sites (`quanben.io`, `twkan.com`, `biquge.tw`); decimal numbering for re-ordering
- **Inngest-driven translation** — serverless-safe, chunked at paragraph boundaries, resumable, cancellable, per-chunk retry
- **Consistency engine** — per-novel glossary (approved terms injected per chunk) + rolling chapter summaries for stable names/tone
- **Reader** — side-by-side raw/translated, paragraph-aligned synced scroll, font size/typeface controls, inline edit, re-translate
- **Translation review** — admin-only script, paragraph-count, and approved-glossary checks with per-chapter findings. Check `first3`, `all`, or decimal ranges such as `1,1.5,5-8`; open a chapter to edit, then run a new check. Reports remain immutable snapshots, mark changed/deleted chapters, and explicitly skip untranslated content. These heuristics do not verify translation accuracy.
- **Guest access** — published content visible to anyone; scheduled publishing (`publishedAt` null/draft/future); best-effort rate-limited reads when trusted ingress is configured
- **Dark mode** — app-wide via `next-themes`, warm charcoal surfaces
- **Export** — chapter/novel to `.txt` or `.epub`
- **Batch translate** — multi-select chapters, queued sequentially

## Tech Stack

TanStack Start (React 19, Vite) + Router + Query · Tailwind v4 (CSS-first `@theme`) · shadcn/ui on Base UI · Drizzle ORM + CockroachDB / PostgreSQL (`postgres` driver) · Better Auth · Inngest (durable translation steps) · `openai` SDK + Gemini REST over controlled Undici transport · oxlint/oxfmt · Vitest · Nitro (Vercel deploy)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/)
- A CockroachDB or PostgreSQL database

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

# Seed admin user (requires SEED_ADMIN_* in .env.local)
bun run seed:user

# Start dev server (port 3000)
bun dev

# Start Inngest dev server in another terminal (for translation & bulk import)
bun run inngest
```

### Commands

| Task                  | Command                                      |
| --------------------- | -------------------------------------------- |
| Dev server            | `bun dev`                                    |
| Inngest dev           | `bun run inngest`                            |
| Production build      | `bun run build`                              |
| Lint / fix            | `bun run lint` / `bun run lint:fix`          |
| Format / check        | `bun run format` / `bun run format:check`    |
| Tests                 | `bun run test`                               |
| PostgreSQL invariants | `bun run test:integration`                   |
| Browser workflow      | `bun run test:e2e`                           |
| Release audit         | `bun run audit:release`                      |
| DB generate / migrate | `bun run db:generate` / `bun run db:migrate` |
| Migrate test database | `bun run db:migrate:test`                    |
| Seed admin user       | `bun run seed:user`                          |
| Regenerate route tree | `bun run generate-routes`                    |

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

The release audit fails on moderate, high, or critical advisories. Direct dependencies and
tooling are exact-pinned; targeted overrides keep legacy tool paths on patched `esbuild`,
`gaxios`, and `adm-zip` releases. Validate reproducibility with `bun install --frozen-lockfile`.

## Environment Variables

| Variable                        | Required | Description                                                                                        |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | Yes      | CockroachDB / PostgreSQL TCP connection string                                                     |
| `TEST_DATABASE_URL`             | No       | Isolated database for `bun run test:integration`                                                   |
| `BETTER_AUTH_SECRET`            | Yes      | 32-byte base64 random string                                                                       |
| `BETTER_AUTH_URL`               | Yes      | App base URL, no trailing slash (e.g. `http://localhost:3000`)                                     |
| `APP_ENCRYPTION_KEY`            | Yes      | 32-byte base64 random string for encrypting API keys at rest                                       |
| `LOCAL_PROVIDER_ORIGINS`        | No       | JSON array of exact canonical HTTP(S) origins allowed to use local/private addresses; default `[]` |
| `RATE_LIMIT_TRUSTED_PROXY_HOPS` | No       | Nonnegative trusted `X-Forwarded-For` hop count; default `0` trusts no client IP headers           |
| `SEED_ADMIN_EMAIL`              | No       | Admin email for `bun run seed:user`                                                                |
| `SEED_ADMIN_NAME`               | No       | Admin display name                                                                                 |
| `SEED_ADMIN_PASSWORD`           | No       | Admin password                                                                                     |
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
    __root.tsx                  # App shell, theme provider, auth context
    _public/                    # Guest-accessible routes
      index.tsx                 # Library (novel grid)
      novels/$novelId/          # Novel detail + chapter list
      novels/$novelId/chapters/$chapterId.tsx  # Reader
    _protected/                 # Admin-only (redirects to /login)
      novels/new.tsx            # Create novel
      novels/$novelId/edit.tsx  # Edit novel
      novels/$novelId/glossary.tsx  # Glossary CRUD
      settings.tsx              # Provider config + account
    login.tsx                   # Login page
  lib/
    auth.ts / auth-client.ts    # Better Auth setup
    translation/                # Chunker, prompts, glossary filter, worker
    scrape.ts / scrape.server.ts # Chapter parser + scraper fetch engine
    scrape.worker.ts            # Inngest bulk chapter import worker
    inngest/functions.ts        # Inngest durable functions
  components/ui/                # Restyled shadcn/Base UI primitives
  styles/globals.css            # Design tokens (@theme)
```

The `postgres` driver uses a maximum pool size of three connections per application process.
That bound is intentional for serverless instances; account for `3 x active instances` when
sizing the database connection limit or external pooler.

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
- `src/lib/scrape/index.ts` is a client-safe facade over pure parsers. DNS resolution and private-IP
  rejection live in the server-only `src/lib/scrape/network-policy.server.ts` boundary.

## Local verification

`bun run test` runs unit tests only. `bun run test:integration` reads the isolated
`TEST_DATABASE_URL` from `.env.local` — it must never be the application database — and
`bun run db:migrate:test` creates that database when missing and applies migrations to it. The
suites skip themselves when the variable is unset. `bun run test:e2e` owns a guarded `*_e2e`
database, app, Inngest dev server, and deterministic OpenAI-compatible stub, then drives login,
novel/chapter creation, translation, publication, logout, and guest reading in an installed Chrome
or Edge browser. Every child process is bounded and torn down on success or failure.

## Docs

- [DESIGN.md](DESIGN.md) — Design system (colors, type, components, Do/Don'ts)
- [AGENTS.md](AGENTS.md) — Developer guide (commands, conventions, architecture notes)

## Deploy

### Vercel

Push to your repo and connect in Vercel. Set all required env vars. The Nitro adapter produces a self-contained Node server.

### Inngest (production)

1. Create an Inngest Cloud account and app in the dashboard
2. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel env
3. Sync the app in the Inngest dashboard — the `/api/inngest` handler auto-registers the `translate-chapter` and `import-chapters` functions
