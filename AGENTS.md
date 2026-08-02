# AGENTS.md — Personal Novel Translator

Single-admin novel translation app (EN→TH default, ZH→EN, ZH→TH) with guest read-only access. TanStack Start + Drizzle/Neon + Better Auth, deployed on Vercel.

> Current repo has no `docs/PLAN.md` or `docs/TASKS.md`; do not cite them as required context.

## Docs map

- [README.md](README.md) — product overview, setup, commands, deployment notes
- [DESIGN.md](DESIGN.md) — **single source of truth for UI**; every component must follow its tokens and §7 Do/Don'ts
- [AGENTS.md](AGENTS.md) — current implementation constraints and operational notes

## Commands

| Task                   | Command                                      |
| ---------------------- | -------------------------------------------- |
| Dev server (port 3000) | `bun dev`                                    |
| Production build       | `bun run build`                              |
| Lint / fix             | `bun run lint` / `bun run lint:fix`          |
| Format / check         | `bun run format` / `bun run format:check`    |
| Tests (vitest)         | `bun run test`                               |
| PostgreSQL invariants  | `bun run test:integration`                   |
| Browser workflow       | `bun run test:e2e`                           |
| DB generate / migrate  | `bun run db:generate` / `bun run db:migrate` |
| Seed admin user        | `bun run seed:user`                          |
| Regenerate route tree  | `bun run generate-routes`                    |
| Inngest dev server     | `bun run inngest` (run alongside `bun dev`)  |
| Translation eval       | `bun run eval:translation <novelId> [ch]`    |

Package manager + script runner: **Bun**. Quality gate: frozen install + `lint` + `format:check` + `typecheck` + unit tests + PostgreSQL integration tests + browser E2E + build + React Doctor + moderate-level dependency audit must stay green.

## Stack

TanStack Start (React 19, Vite) + Router + Query · Tailwind v4 (CSS-first `@theme`, no config file) · shadcn/ui on **Base UI** primitives · zod · oxlint/oxfmt (no ESLint/Prettier/Biome) · drizzle-orm + `postgres` (CockroachDB / PostgreSQL) · better-auth · `openai` SDK against user-configured base URL · next-themes (app-wide dark mode) · fflate (EPUB zip) · nitro (Vercel deploy target)

## Conventions

- **Design tokens only.** Colors/radius/shadows/type come from `@theme` in `src/styles/globals.css` (mirrors DESIGN.md). Semantic tokens (`background`, `foreground`, `muted-foreground`, `border`, `surface`, `surface-2`, `primary`, `primary-foreground`) flip in dark mode — prefer them over the constant palette (`cream`, `charcoal`, `off-white`). Grays are `foreground/<opacity>` (flips) or `charcoal/<opacity>` (fixed) — never arbitrary gray hex/tailwind-gray utilities. Secondary text is `text-muted-foreground`; subtle fills are `bg-muted` (foreground tint). Borders: `border` passive, `foreground/40` interactive — never mixed. Radius: `rounded-sm/md/lg/xl/2xl` = 4/6/8/12/16; `rounded-full` only for pill/icon buttons. Shadows: `shadow-button-inset` (dark buttons), `shadow-focus` (button focus), `shadow-ring-blue` (input focus). Type: `text-display(-alt)/text-section/text-sub/text-card-title/text-body-lg/text-caption`; weights 400/600 only (480 display-alt). No card box-shadows; no pure-white surfaces.
- **Dark mode** is owned by `next-themes` (`ThemeProvider` in `__root.tsx`, `attribute="class"`, `defaultTheme="system"`): it sets `.dark` on `<html>` app-wide, persisted under the `theme` localStorage key. Tokens are CSS vars flipped in `.dark` — always use the semantic utilities so both themes work. The reader's theme control writes to `useTheme()`, never to reader-local state; do not wrap page sections in local `.dark` divs.
- **Reader preferences** (`src/lib/reader/settings.ts`, localStorage key `pnt-reader-settings`): `fontSize`, `typeface`, `viewMode` (`side`/`translated`/`raw`) — all persist across refresh. Theme is **not** part of this object (see above). Reader keyboard shortcuts use `@tanstack/react-hotkeys`; keep shortcuts as progressive enhancement and avoid firing single-key actions from form fields.
- **Fonts:** global stack `"Sofia Sans Variable", "Noto Sans Thai", ui-sans-serif, system-ui`; Thai fallback is mandatory wherever translated text renders; Sarabun (`font-reader`) is the reader long-form option.
- **Imports:** alias `@/*` and `#/*` → `./src/*`.
- **Types:** shared/domain types live in colocated leaf modules (`src/lib/translation/translation.types.ts`, `src/lib/scrape/types.ts`, `src/lib/reader/types.ts`); zod-inferred input types live in their `*.schemas.ts` (`CreateNovelInput`, `UpdateTermInput`, …). `any` is banned — enforced by oxlint `typescript/no-explicit-any`; narrow `catch` vars with `instanceof Error` and validate untrusted JSON with zod.
- **shadcn components** live in `src/components/ui` — restyle their class strings to design tokens, don't fork the structure.
- **Server code:** server functions validated with zod; env access only via `src/lib/env.ts` (zod-parsed, server-only).
- **Routes:** file-based under `src/routes`; `src/routeTree.gen.ts` is generated — never edit by hand.

## Guest access & publishing

- Two layout routes: `_public` (library, novel detail, reader — anyone) and `_protected` (new/edit/glossary/settings — redirects to `/login`). `__root.tsx` `beforeLoad` puts nullable `user` in context; UI gates admin controls on it, but **server functions are the real boundary**.
- Visibility is row-level: `novels.publishedAt` / `chapters.publishedAt` (null = draft, `<= now` = live, `> now` = scheduled). Reads (`listNovels`/`getNovel`/`listChapters`/`getChapter`) apply the live filter only when no session; mutations always require a session. Admin sets them via `PublishMenu` → `setNovelPublished` / `setChapterPublished`. A chapter is guest-visible only when both it and its novel are live. Scheduled publishing is evaluated lazily at read time — no cron sweep.
- Covers are public for live novels (`/api/covers/$`), `Cache-Control: public` for guests.
- **Rate limiting:** guests only (session skips the check). App-level fixed window in the `rate_limits` table via `src/lib/rate-limit.ts` (`checkRateLimit`, 60/min reads, 120/min covers, fail-open). Auth endpoints use better-auth's built-in limiter (`rateLimit.storage: "database"`, `rate_limit` table). No Upstash — escalate there if abuse appears.

## Translation execution (P5.13)

- The browser **never executes translation work** — the client hook only enqueues jobs and polls `getTranslationJobStatus` (read-only). Refreshing the page is always safe.
- Execution is **Inngest-driven**. `startTranslationJob`/`retryTranslationJob` send `translation/job.requested` `{ jobId, runKey }`; `cancelTranslationJob` sends `translation/job.cancelled`.
- The durable function lives in `src/lib/inngest/functions.ts` (`translate-chapter`), served at `GET|POST|PUT /api/inngest` (`inngest/next` handler with `streaming: true` — the only fetch-style handler supporting streaming in SDK 4.13.0; `inngest/edge` lacks it by design. Off Inngest's official streaming matrix for TanStack Start; revert to `inngest/edge` without the flag if a deploy regresses).
- One run per job: `init` step → one `chunk-N` step per chunk → `finalize` step (title + summary + glossary suggestions). Each step is its own HTTP invocation from Inngest, so every chunk gets a fresh 5-min Vercel budget and automatic retries (function `retries: 3`); a crash resumes from the last completed step. Step logic lives in `src/lib/translation/worker.ts` (`initJob`/`translateChunk`/`finalizeJob`/`failJob`), with DB queries isolated in `job-store.ts` and finalization phases in `finalize-summary.ts` & `finalize-glossary.ts`.
- `translation_jobs` stores job metadata; ordered source/progress/output rows live in `translation_job_chunks` under `(job_id, chunk_index)`. Migration 0022 backfills legacy `chunks_json` idempotently. The old column remains dormant for expand/contract rollback compatibility; new code never writes progress to it.
- Enqueue, retry, cancellation, and source/manual-edit invalidation commit a durable `translation_outbox` event intent in the same transaction as state changes. Eager dispatch is best effort, scheduled dispatch recovers pending rows, and due-time comparisons use PostgreSQL `CURRENT_TIMESTAMP` rather than an application clock.
- Duplicate protection: Inngest `idempotency: "event.data.runKey"` (fresh nanoid per enqueue) — no DB lease; `locked_until` column is unused. Steps also re-check job status so cancel/error mid-run exits cleanly; `onFailure` marks job+chapter `error` for the UI.
- **Local:** `bun run inngest` (dev dashboard `localhost:8288`) next to `bun dev`, with `INNGEST_DEV=1` in `.env.local` (SDK v4 defaults to cloud mode) — no keys needed. **Prod:** Inngest Cloud — `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` in Vercel env (optional in the zod schema so local boots keyless), then sync the app in the Inngest dashboard. No cron pinger anywhere.
- The provider client defaults to a 240s timeout (configurable via `provider_settings.request_timeout_sec`) with `maxRetries: 0` (Inngest owns retries at the step level) so a stalled LLM call fails fast instead of burning the step's budget.
- **Auto-split on timeout:** If a chunk translation times out and text > 1200 chars, `worker.ts` auto-splits at the midpoint paragraph boundary via `splitAtParagraphBoundary` in `chunker.ts` and translates halves sequentially up to depth 2.
- **Residual Hanzi visibility:** Admin-only `getResidualHanziChapters({ novelId })` server function (in `src/lib/content/chapter-ops.functions.ts`) pre-filters translated chapters DB-side with the shared `RESIDUAL_CJK_SQL_RE` class, then counts exact matches in JS via `findResidualSourceChars` for flagged rows only (pair-agnostic — any CJK in output is flagged; clean chapters' bodies never leave Postgres); rendered as an amber badge on novel detail chapter table rows. **Inline repair** (`repairResidualHanzi` in `worker.ts`, helpers in `residual-repair.ts`): runs on marked text before `restoreParagraphMarkers` on any residual — surgical span splice first (one JSON call translating extracted Hanzi runs, spliced by offset), whole-chunk retry only when any span >200 chars (passage-level failure); survivors are kept and surface via the badge.
- **Rolling story summary & fast-model routing:** `novels.story_summary` maintains a running novel synopsis (≤400 words) updated during `finalizeJob` and injected into `## Story Context`. Optional `provider_settings.fast_model` routes cheaper non-prose tasks (title, summary, term suggestion/review, story summary) to a cheaper model.
- **Glossary target propagation:** editing a term's target in the glossary UI offers optional find-and-replace across the novel's translated chapters (`previewTermReplacement` + `updateGlossaryTerm` with `applyToChapters`, exact case-sensitive SQL `replace()` — may match inside longer words, UI warns). AI-extracted term notes are written in the target language (prompt-enforced).
- **Offline evaluation script:** `bun run eval:translation <novelId> [chapterNumbers]` (`scripts/eval-translation.ts`) evaluates quality metrics (residual CJK, marker mismatches, dot artifacts, glossary adherence %, token usage, latency) without writing to DB, outputting a summary table and saving a report to `evals/results/<timestamp>.json`. Admin in-app quality reports live in `translation_eval_reports` and run through Inngest (`translation/eval.requested`) using `src/lib/translation/eval-worker.ts`; they evaluate persisted translated content for residual CJK, paragraph mismatches, and glossary adherence.

## Chapter scraping & bulk import

- `src/lib/scrape/index.ts` is a client-safe facade over pure source metadata and HTML parsers in `src/lib/scrape/parsers.ts`: one `SOURCES` entry per supported site (`quanben.io` unproxied; `biquge.tw` unproxied; `twkan.com` via ZenRows proxy API) — new site = new entry. DNS resolution and public-IP enforcement live only in `src/lib/scrape/network-policy.server.ts`; client graphs must never import Node builtins. `quanben` extracts number from URL, title (`h1.headline`), content (`#content p` → `\n\n`), `nextUrl`. `twkan` extracts number from `h1` (`第N章`), content from `#txtcontent0` `<br>` lines, and `nextUrl` from `.page1` links. `biquge` extracts number from `h1` (`第N章`), title (stripping `（1 / 1）` pagination), content from `#chaptercontent` `<p>` lines (filtering ad divs/scripts/ins), and `nextUrl` from `a[rel="next"]`. The facade also exports the provider union, display metadata, and canonical supported-site label.
- Server fns in `src/lib/scrape/functions.ts` (admin-only): `scrapeChapter` (fetch+parse, no write), `importChapter` (fetch+insert, dupe-skip via `(novelId, number)` pre-check). Fetch guards: host whitelist checked before any network I/O (SSRF), https only, redirects blocked (`redirect: "manual"` + 3xx rejection — redirect targets are never followed), 10s timeout (direct) / 30s (proxies), 5MB cap. Providers: `auto` (default site proxy rules with 403 fallback), `direct`, `zenrows` (`SCRAPER_*`), `scrapingbee` (`SCRAPINGBEE_API_KEY`), `firecrawl` (`FIRECRAWL_API_KEY`). Explicit providers do not fall back.
- **Bulk range import is Inngest-driven** (`import-chapters` fn in `src/lib/inngest/functions.ts`, steps in `src/lib/scrape/worker.ts` with DB queries isolated in `src/lib/scrape/job-store.ts`, served via the same `/api/inngest` handler): `startImportJob` creates an `import_jobs` row (storing `scrape_provider`) + sends `scrape/import.requested`; `initImportJob` resolves TOC chapter URLs for `twkan` via `parseTwkanToc` and `biquge` via `parseBiqugeToc`; one step per chapter (`nextNumber` is the resume cursor), scrape errors count as `failed` and continue, DB errors throw for step retry; `cancelImportJob` sets DB status (steps re-check) + best-effort cancel event. One active job per novel (enqueue cancels the previous). UI polls `getImportJobStatus` (2s) and re-attaches via `getActiveImportJob` on mount — refresh-safe.
- Chapters imported this way land as `status: "raw"` drafts; `setAllChaptersPublished({ novelId, publishedAt })` bulk-publishes (novel detail toolbar → "Publish all").

## Export, backup, observability, and end-to-end verification

- Admin job observability is at `/jobs` via `src/lib/job-observability.functions.ts`; keep it read-only and session-gated. It aggregates recent translation/import jobs, chunk latency, and token counts from existing job tables.
- JSON backup/import lives in `src/lib/backup.functions.ts` and Settings → Data backup. Exports include novels, chapters, covers, and glossary terms; never include provider API keys. Imports always create new draft novels with new IDs and clear active job pointers.
- Authenticated novel downloads are ordinary `GET|HEAD /api/exports/:novelId?format=txt|epub` responses. `src/lib/export/stream.ts` verifies ownership, reads translated chapters in numeric order through a PostgreSQL cursor, and streams TXT or EPUB bytes without base64 or whole-novel buffering.
- `bun run test:integration` requires an isolated `TEST_DATABASE_URL` and covers migration backfill/idempotence, concurrent ownership, stale finalization, outbox recovery, and export ownership/order/headers/bytes. It must never fall back to `DATABASE_URL`.
- `bun run test:e2e` requires an installed Chrome or Edge and Node for Playwright. The guarded supervisor owns a `*_e2e` database, app, Inngest dev server, and deterministic OpenAI-compatible stub; it drives login → novel/chapter creation → real translation → novel/chapter publication → logout → guest reading and tears down every child on success or failure.
- Direct dependencies are exact-pinned. Release audit fails at moderate severity; overrides keep legacy tool paths on patched `esbuild`, `gaxios`, and `adm-zip` versions. Do not replace pinned project CLIs with moving `@latest` invocations.
