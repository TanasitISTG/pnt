# Personal Novel Translator

A novel translation app (EN→TH default, ZH→EN, ZH→TH) with a single admin and guest read-only access. Paste or scrape chapters, translate with any OpenAI-compatible provider, and read side-by-side with Thai font support.

<img width="1904" height="1016" alt="image" src="https://github.com/user-attachments/assets/e6773d64-f4ea-47ff-9d4c-01c389125374" />
<img width="1904" height="1016" alt="image" src="https://github.com/user-attachments/assets/8f2373f9-d7b1-4d67-8eba-b010b09fa124" />
<img width="1904" height="1016" alt="image" src="https://github.com/user-attachments/assets/5f93259b-5e6d-466c-9c63-397a5a13600c" />
<img width="1904" height="1016" alt="image" src="https://github.com/user-attachments/assets/74e4942b-2db2-46c3-88e0-210be0843012" />

## Features

- **Novel library** — gallery grid with cover uploads (stored in Postgres), language pair display, and translation progress
- **Chapter CRUD** — paste raw text or bulk-import from supported sites; decimal numbering for re-ordering
- **Inngest-driven translation** — serverless-safe, chunked at paragraph boundaries, resumable, cancellable, per-chunk retry
- **Consistency engine** — per-novel glossary (approved terms injected per chunk) + rolling chapter summaries for stable names/tone
- **Reader** — side-by-side raw/translated, paragraph-aligned synced scroll, font size/typeface controls, inline edit, re-translate
- **Guest access** — published content visible to anyone; scheduled publishing (`publishedAt` null/draft/future); rate-limited reads
- **Dark mode** — app-wide via `next-themes`, warm charcoal surfaces
- **Export** — chapter/novel to `.txt` or `.epub`
- **Batch translate** — multi-select chapters, queued sequentially

## Tech Stack

TanStack Start (React 19, Vite) + Router + Query · Tailwind v4 (CSS-first `@theme`) · shadcn/ui on Base UI · Drizzle ORM + Neon (Postgres HTTP) · Better Auth · Inngest (durable translation steps) · `openai` SDK · oxlint/oxfmt · Vitest · Nitro (Vercel deploy)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/)
- A Neon Postgres database (free tier works)

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

# Seed admin user (requires SEED_ADMIN_* in .env.local)
bun run seed:user

# Start dev server (port 3000)
bun dev

# Start Inngest dev server in another terminal (for translation)
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
| DB generate / migrate  | `bun run db:generate` / `bun run db:migrate` |
| Seed admin user        | `bun run seed:user`                          |
| Regenerate route tree  | `bun run generate-routes`                    |

## Environment Variables

| Variable             | Required | Description                                                        |
| -------------------- | -------- | ------------------------------------------------------------------ |
| `DATABASE_URL`       | Yes      | Neon Postgres connection string (SSL required)                     |
| `BETTER_AUTH_SECRET` | Yes      | 32-byte base64 random string                                       |
| `BETTER_AUTH_URL`    | Yes      | App base URL, no trailing slash (e.g. `http://localhost:3000`)     |
| `APP_ENCRYPTION_KEY` | Yes      | 32-byte base64 random string for encrypting API keys at rest       |
| `SEED_ADMIN_EMAIL`   | No       | Admin email for `bun run seed:user`                                |
| `SEED_ADMIN_NAME`    | No       | Admin display name                                                 |
| `SEED_ADMIN_PASSWORD`| No       | Admin password                                                     |
| `INNGEST_DEV`        | No       | Set to `1` for local dev (SDK v4 defaults to cloud mode)           |
| `INNGEST_EVENT_KEY`  | No       | Inngest Cloud event key (production only)                          |
| `INNGEST_SIGNING_KEY`| No       | Inngest Cloud signing key (production only)                        |

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
    scrape.ts / scrape.worker.ts # Chapter parser + bulk import
    inngest/functions.ts        # Inngest durable functions
  components/ui/                # Restyled shadcn/Base UI primitives
  styles/globals.css            # Design tokens (@theme)
```

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
