# Repository Guidelines

## Project Overview

Personal Novel Translator (PNT) is a single-admin novel translation app. It supports EN→TH by default plus ZH→EN and ZH→TH, guest read-only access to published content, chapter paste/scraping, OpenAI-compatible translation providers, a synchronized reader, glossary/summary consistency, and TXT/EPUB export.

## Architecture & Data Flow

- **Web runtime:** TanStack Start with React 19, TanStack Router/Query, Vite, and Nitro for Vercel. File-based routes live in `src/routes/`; `src/router.tsx` supplies the Query client and SSR query integration.
- **Request/auth flow:** `src/routes/__root.tsx` loads the nullable session into router context. `_public` routes serve guests and admins; `_protected` redirects unauthenticated users to `/login`. API routes handle auth, covers, exports, Inngest, sitemap, and robots responses.
- **Server boundary:** Route-facing operations use TanStack `createServerFn`, validate input with colocated Zod schemas, authenticate with `getSession`/`ensureSession`, query Drizzle, and wrap failures with `withSafeHandler`. Database, environment, provider keys, and Node-only code stay in server-only modules.
- **Persistence:** `src/lib/db/schema/` defines PostgreSQL/CockroachDB tables for users/auth, novels/chapters, glossary terms, provider settings, jobs, chunks, outbox events, imports, rate limits, and evaluation reports. `src/lib/db/index.ts` creates the Drizzle client with a pool max of three connections per process.
- **Translation flow:** The browser only enqueues/cancels/retries jobs and polls read-only status; it never runs translation. An enqueue transaction locks the chapter, chunks raw text, invalidates prior active work, writes job/chunk rows, advances chapter generation, and records a `translation_outbox` event. Inngest runs `init`, one memoized `chunk-N` step per chunk, and `finalize`, with retries, cancellation, per-novel concurrency, and `runKey` idempotency. `worker.ts`, `job-store.ts`, `job-state.ts`, and `outbox.ts` enforce generation/source-revision/active-job ownership and atomic finalization.
- **Import/scrape flow:** `src/lib/scrape/index.ts` exposes client-safe metadata and pure parsers. Server fetches go through bounded HTTPS/manual-redirect checks and `network-policy.server.ts` SSRF/DNS protections. Bulk imports are resumable Inngest jobs with one chapter step at a time.
- **Visibility/export:** Guest reads apply novel and chapter `publishedAt` live filters and guest rate limits; mutations always require a session and ownership. Authenticated exports stream chapters in numeric order through a PostgreSQL cursor as TXT/EPUB rather than buffering a whole novel.
- **Durable invariants:** `architect.md` is authoritative for job state, stale-worker rejection, source revision/generation rules, outbox delivery, per-novel ordering, glossary propagation, export streaming, and scrape client/server boundaries.

## Key Directories

| Directory | Purpose |
| --- | --- |
| `src/routes/` | File-based public/protected pages and API handlers. |
| `src/components/` | Feature UI plus restyled shadcn/Base UI primitives in `ui/`. |
| `src/lib/content/` | Novel/chapter CRUD, publishing, ownership, covers, and schemas. |
| `src/lib/translation/` | Chunking, prompts, provider clients, job APIs/state/store, worker, outbox, and evaluation. |
| `src/lib/scrape/` | Source registry, HTML parsers, safe fetches, network policy, and import worker. |
| `src/lib/inngest/` | Inngest client and durable function registration. |
| `src/lib/db/` | Server-only Drizzle connection and schema modules. |
| `src/lib/auth/`, `glossary/`, `reader/`, `export/`, `settings/` | Authentication, glossary propagation, persisted reader preferences/progress, streaming exports, and provider/account settings. |
| `src/styles/globals.css` | Tailwind v4 CSS-first theme, semantic tokens, light/dark variables, and font stacks. |
| `scripts/` | Migrations, seed user, postbuild Vercel patch, translation evaluation, and E2E supervisor. |
| `e2e/` | Playwright browser workflow; integration tests are colocated under `src/**/*.integration.test.ts`. |
| `drizzle/` | Generated PostgreSQL migrations and migration metadata. |

## Development Commands

Use Bun from the repository root. Typical local setup:

```bash
bun install
# PowerShell: Copy-Item .env.example .env.local
bun run db:migrate
bun run seed:user
bun dev                 # http://localhost:3000
bun run inngest         # second terminal, http://localhost:8288
```

| Task | Command |
| --- | --- |
| Dev server | `bun dev` |
| Inngest local server | `bun run inngest` |
| Production build / preview | `bun run build` / `bun run preview` |
| Regenerate TanStack route tree | `bun run generate-routes` |
| Lint / auto-fix | `bun run lint` / `bun run lint:fix` |
| Format / check | `bun run format` / `bun run format:check` |
| Typecheck | `bun run typecheck` |
| Unit tests | `bun run test` |
| PostgreSQL integration tests | `TEST_DATABASE_URL=... bun run test:integration` |
| Browser workflow | `bun run test:e2e` |
| Generate/apply migrations | `bun run db:generate` / `bun run db:migrate` |
| Seed admin | `bun run seed:user` |
| Translation evaluation | `bun run eval:translation <novelId> [chapterNumbers]` |
| React diagnostics / dependency audit | `bun run doctor` / `bun run audit:release` |

Database migrations are a release operation, not a Vercel build operation. Production Vercel builds use the frozen lockfile and `vercel.json` runs `bun run build && bun run postbuild`; `postbuild` sets the server function limit needed by long Inngest steps.

## Code Conventions & Common Patterns

- **TypeScript:** Strict compiler settings, no unused locals/parameters, no explicit `any`, no unchecked side-effect imports, and no fallthrough. Prefer named exports, descriptive camelCase symbols, and colocated leaf types such as `translation.types.ts`, `reader/types.ts`, and `*.schemas.ts` for Zod-inferred inputs. Use `@/` (or `#/`) aliases instead of long relative imports.
- **Server functions:** Follow `createServerFn({ method })` + `.validator(schema)` + `.handler(...)`. Use `ensureSession()` for mutations, verify resource ownership through the novel/user join, apply guest publication filters and `checkRateLimit` to public reads, and return safe errors through `withSafeHandler`/`SafeServerError`.
- **Errors and untrusted data:** Catch variables are `unknown`; narrow with `instanceof Error`. Validate request/form/JSON input with Zod. Unknown server failures are logged and exposed as a generic safe message. Do not leak provider keys or internal database details.
- **Database/state:** Drizzle properties are camelCase over snake_case columns. Use `nanoid()` IDs, transactions, and `for('update')` locks for job ownership/state changes. Keep source revisions, translation generations, active job IDs, and outbox intent consistent; do not implement worker validity rules in route handlers.
- **Async jobs:** Keep LLM work in Inngest workers. Use memoized steps and explicit cancellation/idempotency; sequential chunk loops are intentional because each chunk depends on prior context. Client job hooks are refresh-safe polling/enqueue controls, not workers. Use `Promise.all` only for independent reads.
- **Client state:** Use TanStack Query loaders/query options and invalidate affected keys after mutations. Reader `fontSize`, `typeface`, and `viewMode` persist under `pnt-reader-settings`; app theme belongs to `next-themes`, not reader-local state. Avoid single-key shortcuts while focus is in form fields.
- **UI/design:** Use shadcn components on Base UI primitives and Tailwind semantic design tokens from `src/styles/globals.css`. Prefer semantic `background`, `foreground`, `muted-foreground`, `border`, `surface`, and `primary` utilities so dark mode works. Keep the Sofia Sans + Noto Sans Thai stack (Sarabun is the reader option), warm surfaces, restrained borders, and shallow depth; avoid arbitrary gray/hex colors, pure white/black, heavy card shadows, saturated accents, and weight 700. Consult `DESIGN.md` before changing UI.
- **Security boundaries:** Keep environment access in `src/lib/env.ts`; provider API keys are encrypted at rest. Scraping must preserve host allowlists, HTTPS, manual redirect rejection, body/time limits, and private-IP blocking. Covers require content validation, not only a declared MIME type.
- **Generated/configured files:** Never hand-edit `src/routeTree.gen.ts`, `drizzle/*.sql`, `drizzle/meta/*.json`, or build output. Update route source/config and regenerate. Preserve current dependency pins/ranges and security/tooling overrides unless intentionally changing the dependency policy.

## Important Files

- `package.json` — canonical Bun scripts, pinned dependencies, overrides, and package manager version.
- `src/router.tsx` — router, Query context, SSR query integration, and preload defaults.
- `src/routes/__root.tsx`, `src/routes/_public.tsx`, `src/routes/_protected.tsx` — app shell/session context and route access boundaries.
- `src/lib/env.ts`, `src/lib/db/index.ts`, `src/lib/db/schema/index.ts` — validated server environment and database wiring.
- `src/lib/auth/functions.ts`, `src/lib/content/*.functions.ts` — session helpers and authenticated content operations.
- `src/lib/translation/translation.functions.ts`, `worker.ts`, `job-store.ts`, `job-state.ts`, `outbox.ts` — translation enqueue/read APIs, durable execution, invariants, and delivery.
- `src/lib/inngest/functions.ts` — translation, import, evaluation, and outbox Inngest functions.
- `src/lib/scrape/index.ts`, `parsers.ts`, `server.ts`, `network-policy.server.ts`, `worker.ts` — scraping boundaries and bulk import.
- `src/styles/globals.css`, `vite.config.ts`, `tsconfig.json`, `.oxlintrc.json`, `drizzle.config.ts` — UI tokens, build, compiler, lint, and migration configuration.
- `scripts/e2e/run.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` — disposable E2E supervisor, browser settings, and CI quality gate.
- `architect.md` — concurrency and persistence invariants; read it before changing translation workflow behavior.

The README's compact project tree contains older shorthand for auth/scrape modules. Use the current canonical paths under `src/lib/auth/` and `src/lib/scrape/` above.

## Runtime/Tooling Preferences

- Required package manager/runtime: **Bun 1.3.14**, with `bun.lock`; the package is ESM (`"type": "module"`). Do not substitute npm/pnpm commands or floating CLI versions.
- Application stack: React 19, TanStack Start/Router/Query, Vite, Tailwind v4 CSS-first tokens, shadcn Base UI, Drizzle/PostgreSQL, Better Auth, Inngest, and Nitro/Vercel.
- Formatting/linting: Oxfmt and Oxlint are canonical; there is no ESLint/Prettier/Biome workflow. `react-doctor` is a separate diagnostics command.
- Environment: copy `.env.example` to `.env.local`; access server env only through `src/lib/env.ts`. Local Inngest is keyless with `INNGEST_DEV=1`; production requires Inngest Cloud event/signing keys. Never commit `.env*`, provider credentials, or linked Vercel metadata.
- Database: use PostgreSQL/CockroachDB-compatible `DATABASE_URL`; run migrations explicitly. Integration/E2E databases must be disposable and isolated.
- Deployment: Nitro targets Vercel. `vercel.json` uses frozen installation and the postbuild patch for a 300-second server function budget. The app's Inngest endpoint is `/api/inngest`.

## Testing & QA

- **Unit tests:** Vitest runs colocated `src/**/*.test.ts`/`.test.tsx` files. `bun run test` excludes `**/*.integration.test.ts` and `e2e/**`. Tests should defend observable behavior, boundaries, state transitions, error handling, and compatibility—not implementation details. No coverage threshold/config is defined; preserve meaningful contract coverage.
- **Integration tests:** `bun run test:integration` runs the explicit translation workflow/outbox/chunk migration, export streaming, and content maintenance suites. Set an isolated `TEST_DATABASE_URL`; never let integration tests fall back to `DATABASE_URL`. The Windows helper `.tura/script/run-postgres-integration.ps1` owns a disposable PostgreSQL service and cleanup.
- **E2E:** `bun run test:e2e` uses `scripts/e2e/run.ts` to guard a disposable database name ending in `_e2e`, apply migrations, seed an admin/provider, start the app, Inngest dev server, and deterministic OpenAI-compatible stub, then run Playwright. It requires an installed Chrome or Edge; no browser download is attempted. The workflow covers login, novel/chapter creation, real queued translation, publication, logout, and guest reading.
- **CI gate:** `.github/workflows/ci.yml` runs frozen Bun install, migrations, `format:check`, lint, typecheck, unit tests, PostgreSQL integration tests, E2E, build, and the moderate-level dependency audit. Run the relevant command locally before claiming a change is complete; use `bun run doctor` for React-specific diagnostics.
