<!-- intent-skills:start -->

## Skill Loading

Before editing files for a substantial task:

- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

# AGENTS.md — Personal Novel Translator

Single-admin novel translation app (EN→TH default, ZH→EN, ZH→TH) with guest read-only access. TanStack Start + Drizzle/Neon + Better Auth, deployed on Vercel.

> This file covers Phase 8 state and is finalized at P8.9. Task IDs (`P<phase>.<n>`) reference [docs/TASKS.md](docs/TASKS.md).

## Docs map

- [docs/PLAN.md](docs/PLAN.md) — approved build plan (product decisions, stack, data model, route map, phases)
- [docs/TASKS.md](docs/TASKS.md) — task breakdown with IDs and acceptance criteria
- [DESIGN.md](DESIGN.md) — **single source of truth for UI**; every component must follow its tokens and §7 Do/Don'ts

## Commands

| Task                   | Command                                      |
| ---------------------- | -------------------------------------------- |
| Dev server (port 3000) | `bun dev`                                    |
| Production build       | `bun run build`                              |
| Lint / fix             | `bun run lint` / `bun run lint:fix`          |
| Format / check         | `bun run format` / `bun run format:check`    |
| Tests (vitest)         | `bun run test`                               |
| DB generate / migrate  | `bun run db:generate` / `bun run db:migrate` |
| Seed admin user        | `bun run seed:user`                          |
| Regenerate route tree  | `bun run generate-routes`                    |
| Inngest dev server     | `bun run inngest` (run alongside `bun dev`)  |

Package manager + script runner: **Bun**. Quality gate: `lint` + `format:check` + `test` must stay green.

## Stack

TanStack Start (React 19, Vite) + Router + Query · Tailwind v4 (CSS-first `@theme`, no config file) · shadcn/ui on **Base UI** primitives · zod · oxlint/oxfmt (no ESLint/Prettier/Biome) · drizzle-orm + `@neondatabase/serverless` (HTTP) · better-auth · `openai` SDK against user-configured base URL · next-themes (app-wide dark mode) · fflate (EPUB zip) · nitro (Vercel deploy target)

## Conventions

- **Design tokens only.** Colors/radius/shadows/type come from `@theme` in `src/styles/globals.css` (mirrors DESIGN.md). Semantic tokens (`background`, `foreground`, `muted-foreground`, `border`, `surface`, `surface-2`, `primary`, `primary-foreground`) flip in dark mode — prefer them over the constant palette (`cream`, `charcoal`, `off-white`). Grays are `foreground/<opacity>` (flips) or `charcoal/<opacity>` (fixed) — never arbitrary gray hex/tailwind-gray utilities. Secondary text is `text-muted-foreground`; subtle fills are `bg-muted` (foreground tint). Borders: `border` passive, `foreground/40` interactive — never mixed. Radius: `rounded-sm/md/lg/xl/2xl` = 4/6/8/12/16; `rounded-full` only for pill/icon buttons. Shadows: `shadow-button-inset` (dark buttons), `shadow-focus` (button focus), `shadow-ring-blue` (input focus). Type: `text-display(-alt)/text-section/text-sub/text-card-title/text-body-lg/text-caption`; weights 400/600 only (480 display-alt). No card box-shadows; no pure-white surfaces.
- **Dark mode** is owned by `next-themes` (`ThemeProvider` in `__root.tsx`, `attribute="class"`, `defaultTheme="system"`): it sets `.dark` on `<html>` app-wide, persisted under the `theme` localStorage key. Tokens are CSS vars flipped in `.dark` — always use the semantic utilities so both themes work. The reader's theme control writes to `useTheme()`, never to reader-local state; do not wrap page sections in local `.dark` divs.
- **Reader preferences** (`src/lib/reader-settings.ts`, localStorage key `pnt-reader-settings`): `fontSize`, `typeface`, `viewMode` (`side`/`translated`/`raw`) — all persist across refresh. Theme is **not** part of this object (see above).
- **Fonts:** global stack `"Sofia Sans Variable", "Noto Sans Thai", ui-sans-serif, system-ui`; Thai fallback is mandatory wherever translated text renders; Sarabun (`font-reader`) is the reader long-form option.
- **Imports:** alias `@/*` and `#/*` → `./src/*`.
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
- Execution is **Inngest-driven**. `startTranslationJob`/`retryTranslationJob` send `translation/job.requested` `{ jobId, runKey }`; `cancelTranslationJob` sends `translation/job.cancelled`. The durable function lives in `src/lib/inngest/functions.ts` (`translate-chapter`), served at `GET|POST|PUT /api/inngest` (`inngest/edge` handler).
- One run per job: `init` step → one `chunk-N` step per chunk → `finalize` step (title + summary + glossary suggestions). Each step is its own HTTP invocation from Inngest, so every chunk gets a fresh 5-min Vercel budget and automatic retries (function `retries: 3`); a crash resumes from the last completed step. Step logic lives in `src/lib/translation/worker.ts` (`initJob`/`translateChunk`/`finalizeJob`/`failJob`).
- Duplicate protection: Inngest `idempotency: "event.data.runKey"` (fresh nanoid per enqueue) — no DB lease; `locked_until` column is unused. Steps also re-check job status so cancel/error mid-run exits cleanly; `onFailure` marks job+chapter `error` for the UI.
- **Local:** `bun run inngest` (dev dashboard `localhost:8288`) next to `bun dev`, with `INNGEST_DEV=1` in `.env.local` (SDK v4 defaults to cloud mode) — no keys needed. **Prod:** Inngest Cloud — `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` in Vercel env (optional in the zod schema so local boots keyless), then sync the app in the Inngest dashboard. No cron pinger anywhere.
- The provider client sets a 4-min request timeout with `maxRetries: 0` (Inngest owns retries at the step level) so a stalled LLM call fails fast instead of burning the step's budget.

## Chapter scraping & bulk import

- Parser/whitelist lives in `src/lib/scrape.ts` (pure module, client-safe): one `SOURCES` entry per supported site (quanben.io only so far) — new site = new entry. Extracts number (from URL), title (`h1.headline`, `第NNN章` prefix stripped), content (`#content p` → `\n\n`), and `nextUrl`.
- Server fns in `src/lib/scrape.functions.ts` (admin-only): `scrapeChapter` (fetch+parse, no write), `importChapter` (fetch+insert, dupe-skip via `(novelId, number)` pre-check). Fetch guards: host whitelist before any network I/O (SSRF), https only, `redirect: "error"`, 10s timeout, 2MB cap.
- **Bulk range import is Inngest-driven** (`import-chapters` fn in `src/lib/inngest/functions.ts`, steps in `src/lib/scrape.worker.ts`, served via the same `/api/inngest` handler): `startImportJob` creates an `import_jobs` row + sends `scrape/import.requested`; one step per chapter (`nextNumber` is the resume cursor), scrape errors count as `failed` and continue, DB errors throw for step retry; `cancelImportJob` sets DB status (steps re-check) + best-effort cancel event. One active job per novel (enqueue cancels the previous). UI polls `getImportJobStatus` (2s) and re-attaches via `getActiveImportJob` on mount — refresh-safe.
- Chapters imported this way land as `status: "raw"` drafts; `setAllChaptersPublished({ novelId, publishedAt })` bulk-publishes (novel detail toolbar → "Publish all").
