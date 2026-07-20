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

Single-admin novel translation app (EN→TH default, ZH→EN, ZH→TH). TanStack Start + Drizzle/Neon + Better Auth, deployed on Vercel.

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
| Translation worker     | `bun run worker` (run alongside `bun dev`)   |

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

## Translation execution (P5.13)

- The browser **never executes translation work** — the client hook only enqueues jobs and polls `getTranslationJobStatus` (read-only). Refreshing the page is always safe.
- Work runs in `src/lib/translation/worker.ts`, invoked via `GET|POST /api/cron/translation-worker` with `Authorization: Bearer ${CRON_SECRET}`. One chunk (or finalization) per job per run.
- **Local:** run `bun run worker` next to `bun dev` (pings every 5s). **Prod:** cron-job.org pings the endpoint every 1 min (Hobby plan — Vercel Cron is 1/day there); disable its failure alerts, a ping "timeout" during a long chunk is harmless.
- Concurrency is serialized by the `translation_jobs.locked_until` lease (15 min, atomic conditional UPDATE). Crash → lease expires → next ping resumes. Never process a job outside this lease.
- `CRON_SECRET` (min 32 chars) is a required env var — must exist in `.env.local` and Vercel project env, or the server refuses to boot.
