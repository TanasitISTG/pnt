# Design System

The system of record for the Pnt interface. Code is the other half: tokens live in
[`src/styles/globals.css`](src/styles/globals.css), primitives in [`src/components/ui/`](src/components/ui),
and the guardrails are the `shadcn/*` rules in [`.oxlintrc.json`](.oxlintrc.json).

[`REDESIGN.md`](REDESIGN.md) is the roadmap — the audit, the route map, the phase plan. This file is
the standard. Where a surface that a later phase has not rebuilt yet disagrees with this document,
the phase that rebuilds it is the one that reconciles them; nothing here is aspirational for the
surfaces `REDESIGN.md` §4 lists as shipped.

The reference this system started from was a marketing site. This is an application: a catalog, a
reader, an owner studio and an operator console, in two languages, used daily by the same people.
The rules below are what that difference changes.

---

## 1. Principles

1. **Bilingual editorial.** Warm paper, one ink accent, and the language pair (`EN → TH`) treated as
   a first-class typographic unit — on cards, headers, filters and the reader. Thai always renders
   through the Noto Sans Thai fallback.
2. **Borders over shadows.** Containment is a hairline border on a tinted surface. Shadows are
   reserved for things that genuinely float (overlays) and for the primary button's inset signature.
3. **One accent, one meaning.** Ink marks interaction: links, focus, selection, emphasis that is
   clickable. Terracotta means destruction only. Nothing else is saturated.
4. **A small vocabulary.** Thirteen button variants became three treatments plus status tones;
   twenty badge variants became the same three. A new variant is added to the primitive, never
   restyled at the call site (§7.5).
5. **States are contracts.** Loading, empty, no-match, error and success have one implementation each
   and are named the same way everywhere (§8.3).
6. **Motion is a budget.** Every animation names its purpose and its duration token; anything that
   would fire hundreds of times a day does not animate (§5).

---

## 2. Color

Four tiers. A page never invents a value, and no component picks a hue directly.

| Tier | Role | Tokens |
| ---- | ---- | ------ |
| 0 | Constant palette — never flips with the theme | `cream` `#f7f4ed`, `charcoal` `#1c1c1c`, `off-white` `#fcfbf8` |
| 1 | Surfaces — flip per theme and per reader page theme | `surface-0` · `surface` · `surface-2` · `surface-3` · `surface-inset` |
| 2 | Foregrounds and borders | `foreground` · `muted-foreground` · `fg-3` · `border` · `border-strong` |
| 3 | The accent | `ink` · `ink-foreground` · `ink-quiet` |

### 2.1 Surfaces, foregrounds, borders

| Token | Light | Dark | Where it is used |
| ----- | ----- | ---- | ---------------- |
| `background` / `surface-0` | `#f7f4ed` | `#1c1c1c` | The page |
| `surface` (`card`) | `#fbf9f4` | `#232320` | Panels, cards, table headers |
| `surface-2` (`popover`) | `#fdfcf9` | `#2a2a27` | Popovers, menus, sheets, dialogs |
| `surface-3` | `#fefdfa` | `#333330` | Tooltips, the topmost layer |
| `surface-inset` | `rgba(28,28,28,.04)` | `rgba(247,244,237,.06)` | Recessed fills: hover, skeletons, icon wells |
| `foreground` | `#1c1c1c` | `#f7f4ed` | Body and headings |
| `muted-foreground` | `#5f5f5d` | `#a3a3a0` | Secondary copy, metadata |
| `fg-3` | `#7a7a76` | `#8a8a86` | Tertiary: disabled labels, placeholder tabular data |
| `border` | `#eceae4` | `rgba(247,244,237,.1)` | Passive division |
| `border-strong` | `rgba(28,28,28,.28)` | `rgba(247,244,237,.28)` | Interactive boundary: outline buttons, chips, inputs on tinted surfaces |

Every neutral is charcoal in light and cream in dark at some opacity — the tonal model is
opacity-driven, which is why a new grey is never a new hex value.

### 2.2 The accent

Ink is the only accent, and it is used for exactly four things: links, `aria-current` emphasis, the
focus ring, and text selection.

| Token | Light | Dark |
| ----- | ----- | ---- |
| `ink` | `#33507a` | `#a8c0e2` |
| `ink-foreground` | `#fcfbf8` | `#16233a` |
| `ink-quiet` | `rgba(51,80,122,.08)` | `rgba(168,192,226,.14)` |

`ink-quiet` is the selection wash and the tint behind an ink-on-surface moment. Ink is never a
button fill (primary is charcoal/cream), never a status, and never decorative.

### 2.3 Status

Statuses are **text plus a tinted surface plus a border at 30–40% of the same tone** — never a solid
fill, so a screen full of statuses stays calm.

| Token | Light | Dark | Meaning |
| ----- | ----- | ---- | ------- |
| `success` | `#53604b` | `#bcc7b5` | Live, published, completed |
| `warning` | `#735735` | `#d5b991` | Needs attention, scheduled, stale |
| `info` | `#505f65` | `#b8c5ca` | Neutral information |
| `destructive` | `#a8442f` | `#a8442f` | Destructive **fills** only |
| `destructive-text` | `= destructive` | `#e6a18f` | Destructive outlines, ghosts, error text |

Rule: a red *outline* or *ghost* action, a destructive badge and every error message use
`destructive-text`; only a filled destructive button uses `destructive`.

### 2.4 Reader page themes

The reader overrides the tier-1/2/3 tokens for its own luminance needs. They are declared after
`.dark` so they win on equal specificity, and each sets `color-scheme` with `!important` because
`next-themes` writes it inline on `<html>`.

| Theme | Background | Foreground | Character |
| ----- | ---------- | ---------- | --------- |
| `app` | the app theme | — | Default; no override |
| `sepia` | `#f4ecd8` | `#5b4636` | Long-form, warm |
| `paper` | `#f6f6f2` | `#1f1f1c` | Long-form, neutral |

A page theme beats an app dark theme — that is the point of the override — and turning it off
restores the app theme with its own `color-scheme`.

### 2.5 Do / don't

**Do** derive neutrals by opacity, use `border` for passive division and `border-strong` for anything
interactive, keep body text at ≥4.5:1 and UI borders/icons at ≥3:1, and let `surface-inset` carry
"recessed".

**Don't** use pure white or pure black as a surface, add a saturated accent, put ink on a button
fill, use a status colour as a fill, use `#000000`-based shadows in dark mode, or hand-pick a hex
value in a component.

---

## 3. Typography

**Families.** `--font-sans` = `"Sofia Sans Variable", "Noto Sans Thai", ui-sans-serif, system-ui`;
`--font-reader` = `"Sarabun", "Noto Sans Thai", …`. The Thai fallback is mandatory wherever
translated text can render. Weights: **400** body, **500** interface, **600** titles, **480** the
display alternative.

### 3.1 Ramp

| Token | Size | Weight | Tracking | Line height | Use |
| ----- | ---- | ------ | -------- | ----------- | --- |
| `text-display` | `clamp(2.25rem, 1.55rem + 3.1vw, 3.25rem)` | 600 | -0.03em | 1.04 | Quiet pages: auth, legal, 404 |
| `text-display-alt` | `clamp(2rem, 1.5rem + 2.2vw, 2.75rem)` | 480 | -0.02em | 1.08 | The alternative display voice |
| `text-section` | `clamp(1.75rem, 1.35rem + 1.7vw, 2.375rem)` | 600 | -0.024em | 1.08 | A page's `h1` |
| `text-sub` | `clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem)` | 600 | -0.018em | 1.15 | Section `h2` |
| `text-title` | `clamp(1.5rem, 1.25rem + 1.1vw, 2rem)` | 600 | -0.02em | 1.12 | A novel title on its own page |
| `text-card-title` | `1.0625rem` | 600 | -0.01em | 1.3 | Card and panel titles |
| `text-body-lg` | `1.0625rem` | 400 | — | 1.55 | Lead paragraphs, nav links |
| `text-body` | `1rem` | 400 | — | 1.6 | Body and controls |
| `text-caption` | `0.8125rem` | 400 | — | 1.5 | Metadata, helper text |
| `text-micro` | `0.6875rem` | 400 | — | — | Dense counters |
| `text-badge-count` | `0.625rem` | 400 | — | — | Count inside a pill |
| `text-metric` | `clamp(1.75rem, 1.3rem + 2vw, 2.25rem)` | 600 | — | — | A single number that answers a question |
| `tracking-overline` | — | — | 0.14em | — | The only place tracking opens up |

The ramp is fluid on purpose: it is an application viewed on a phone at 320px and a 27-inch monitor
in the same hour, so a step is a range, not a size.

### 3.2 Rules

- Titles are weight 600; nothing is weight 700. Big text gets tighter tracking, never looser.
- Numbers in tables, counters and progress statements use `tabular-nums`.
- `h1–h4` get `text-wrap: balance`; `p` and `li` get `text-wrap: pretty` (base layer).
- The reader's `typeface`, `fontSize`, `lineHeight` and `measure` are the reader's own settings and
  do not leak into the app chrome — and app chrome never overrides the reader's prose.
- One `h1` per page; a section's `h2` is what the section is called in navigation, so anchors
  (`aria-labelledby`) point at the same words the user read.

---

## 4. Layout and space

- **Rhythm**: the scale is Tailwind's 4px ladder; panels are `gap-3`–`gap-6`, page sections
  `gap-8`–`gap-12`. Choose from the ladder; never an arbitrary margin.
- **Container**: `max-w-[1200px]` centred, `px-4` at 320–640px and `px-6` above, in both the header
  and the page body so their edges align.
- **Density**: a surface is *spacious* (catalog, reading home, quiet pages) or *dense* (studio
  tables, console). Dense surfaces reduce padding and type step, never touch-target size.
- **Targets**: 44px minimum for any icon control. 36px (`icon-sm`) is permitted only inside dense
  console rows and overlay corners, and is the only documented exception.
- **Columns**: one column at 320px with no horizontal scroll, in either language. Grids gain columns
  at `sm` (2), `lg` (3–4); nothing is placed by magic numbers.
- **Reader measure**: capped by the reader's own measure setting, not by the page container.

---

## 5. Shape and elevation

### 5.1 Radius

| Token | Value | Use |
| ----- | ----- | --- |
| `rounded-sm` | 3px | Badges, chips, tiny wells |
| `rounded-md` | 6px | Buttons, inputs, skeletons |
| `rounded-lg` | 8px | Menus, compact panels |
| `rounded-xl` | 10px | Cards, panels, notices, dialogs |
| `rounded-2xl` | 14px | Large containers, drawer sheets |
| `rounded-full` | — | Icon toggles and counting pills **only** |

### 5.2 Elevation

| Level | Treatment | Use |
| ----- | --------- | --- |
| Flat | no shadow | Page, most content |
| Bordered | `border` on `surface` | Cards, panels, tables |
| Inset | `shadow-button-inset` | Primary/`pill`/`cream` buttons |
| Focus | `outline-ring` at 2px with offset | Keyboard focus (§7.4) |
| Pop | `shadow-pop` | Menus, popovers, dialogs, sheets |

`shadow-pop` is warm and diffused in light, deeper in dark; it is the only lift in the system. A
card never floats.

---

## 6. Motion

### 6.1 Tokens

| Token | Value | Budget for |
| ----- | ----- | ---------- |
| `--dur-press` | 120ms | Press feedback |
| `--dur-micro` | 160ms | Hover, colour and border changes, chips |
| `--dur-ui` | 200ms | Dropdowns, selects, popovers, dialogs |
| `--dur-panel` | 280ms | Sheets, drawers, route transitions |
| `--dur-modal` | 360ms | Large modals |
| `--ease-out-quint` | `cubic-bezier(.22,1,.36,1)` | Default for anything entering |
| `--ease-in-out-quart` | `cubic-bezier(.76,0,.24,1)` | Symmetrical moves |
| `--ease-drawer` | `cubic-bezier(.32,.72,0,1)` | Panels travelling from an edge |

Tailwind has no duration namespace, so each budget is also a utility: `duration-press`, `duration-micro`,
`duration-ui`, `duration-panel`, `duration-modal` (plus `transition-width`).

### 6.2 What animates, and why

| Moment | Budget | Purpose |
| ------ | ------ | ------- |
| Press | 120ms, `scale(.98)` | Feedback |
| Hover on card/row | 160ms, border or fill | Feedback |
| Menu / select / popover | 200ms, scale from the trigger | Spatial consistency |
| Dialog | 200–280ms | Preventing a jarring change |
| Sheet / drawer | 280ms, `--ease-drawer`, panel travels | Spatial consistency |
| Route change | 200–280ms View Transition | Preventing a jarring change |
| Mobile nav links | 280ms + 40ms stagger | Occasional surface; sequence is legible |

### 6.3 What deliberately does not

Reader chapter turns and every keyboard-initiated move (fast, hundreds of times a session), row
stagger in dense tables, scroll reveals in prose, hover lift on every card, `scale(0)` entrances,
and route-level exit animations — TanStack Router unmounts the previous match immediately, so View
Transitions own route changes instead. Route transitions are opt-in per navigation (`viewTransition`
on the `Link`), never global.

### 6.4 Overlay classes

Base UI keeps a popup mounted while a transition runs, so the transition is declared on the resting
element and `data-starting-style` / `data-ending-style` supply the "from" state:
`.overlay-fade`, `.overlay-pop` (origin from `--transform-origin`, so it grows from its trigger),
`.overlay-sheet`, `.overlay-slide-start`, `.overlay-slide-end`, and `.skip-link` (instant, because a
keyboard-triggered affordance that animates reads as lag).

### 6.5 Reduced motion

The global `@media (prefers-reduced-motion: reduce)` rule stops looping animation and collapses
transitions to 0.01ms. Surfaces driven by Motion branch on `useReducedMotion()` and drop spatial
movement while keeping the state change legible — never by hiding the change. `animate-pulse` on a
skeleton is `motion-safe:`, because a looping pulse is decorative.

---

## 7. Components

Built on Base UI through the shadcn convention. Every primitive in `src/components/ui/` owns its
geometry, colour, spacing and shape; a call site passes content and, at most, layout.

| Group | Components |
| ----- | ---------- |
| Actions | `Button`, `Toggle`, `ToggleGroup`, `SegmentedControl` |
| Status & feedback | `Badge`, `InlineNotice`, `EmptyState`, `ErrorState`, `Skeleton`, `Spinner`, `sonner` toasts |
| Surfaces | `Card`, `Dialog`, `Sheet`, `Popover`, `Tooltip`, `Accordion`, `Collapsible` |
| Forms | `Field`/`FieldGroup`, `Input`, `Textarea`, `Select`, `Label`, `Checkbox`, `Slider` |
| Data | `Table` + `data-table-parts`, `use-data-table`, `Sortable`, `Progress`, `Avatar` |
| Domain | `LangPair` (the `EN → TH` unit), `NovelCover`, `UserAvatar` |

### 7.1 Button

Three treatments, plus status tones that only re-tone text and hover:

| Family | Variants | Use |
| ------ | -------- | --- |
| Filled | `default`, `destructive` | One primary action per view |
| Outline | `outline`, `outlineWarning`, `outlineDestructive`, `outlineDestructiveStrong` | Secondary actions |
| Borderless | `ghost`, `ghostPrimary`, `ghostMuted`, `ghostWarning`, `ghostDestructive` | Tertiary, toolbars, rows |
| Surface | `cream`, `pill` | Tertiary on a tinted surface; icon toggles |
| Text | `link` | Inline navigation inside prose |

Sizes: `default` 40px, `sm` 36px, `lg` 44px, `icon` 44px round, `icon-sm` 36px round (the documented
dense exception), `chapterOption`, `readerNav`. A `render={<Link/>}` button renders an anchor with
`role="button"` — which is why specs address "Sign in" as a button, not a link.

### 7.2 Badge

Twenty legacy variant names, three treatments: **neutral** (hairline border, foreground text),
**quiet** (recessed fill, muted text) and **tone** (info/warning/success/destructive tint, outline
versions drop the fill). Sizes: `default`, `stat` (mono), `count` (the only full-radius pill,
because it lives inside another control). Badges are informational; a badge never carries an action.

### 7.3 State primitives

- **`Skeleton`** — data-only shapes, no icons or copy. `shape="default"` for text rows,
  `panel` for a card-sized block, `media` for the 3:4 cover (square corners). One pending language
  per surface: a pending region matches the layout it becomes, so the swap does not move the page.
- **`EmptyState`** — `icon`, `title`, `description`, an `h2`, and one obvious action. `size="compact"`
  fits inside a panel. It is an invitation, not a mood: no dashed container, no illustration.
- **`ErrorState`** — `variant="page"` owns a region; `variant="panel"` is a single tinted row for a
  failed section inside a working page. `retryLabel` defaults to "Try again"; a failed *read* keeps
  the word "Retry" (the query wrapper).

### 7.4 Focus

One convention: `focusRing` — a 2px ink outline with 2px offset — and `focusRingInset` for fields
where an outside ring would clip. The base layer adds a zero-specificity `:focus-visible` fallback so
nothing is ever unfocusable, and every component rule wins over it. Never `shadow`-based focus.

### 7.5 The guardrail

`.oxlintrc.json` enforces ownership: `shadcn/no-restyle` fails a call site that restyles a primitive
with anything other than layout (colour, shape, spacing, typography), `shadcn/no-raw-colors` bans hex
and `rgb()` outside `ui/`, and `shadcn/no-arbitrary-values` bans bracket values outside `ui/`.

The escape hatch is a **contract**, not a suppression: a primitive may be exempted per-property, or a
new variant added to the primitive. `Skeleton`'s `shape` prop exists because a shelf placeholder
genuinely needs square corners — that is how a design decision gets recorded in the system instead of
in a className.

---

## 8. Patterns

### 8.1 Shell

`AppShell` renders: skip link → optional impersonation banner → header (`SiteHeader`) → `main#main`
→ footer. `layout="reader"` renders a compact, non-sticky header and no footer, because the reader
owns its own toolbar.

- Header: wordmark → primary nav → appearance menu → account menu (or Sign in / Create account) →
  drawer trigger. Sticky on the default layout only.
- Primary nav: reading destinations only. **Guest: Catalog.** Signed in: Catalog · Library · Jobs.
- Account menu: Profile, Settings, Admin (operators), Sign out. Operator duties never sit in the
  primary nav.
- Every landmark is named (`nav aria-label="Primary"`, `main#main`), and the active item carries
  `aria-current="page"`.

### 8.2 Route map (shipped)

| Route | Surface | Audience |
| ----- | ------- | -------- |
| `/` | Reading home when signed in; the shared catalog for a guest | Both |
| `/catalog` | The shared catalog (`/browse` redirects here, query string preserved) | Both |
| `/library` | The account's own shelf | Signed in |
| `/novels/:novelId` | Public reading page | Both |
| `/novels/:novelId/chapters/:chapterId` | The reader | Both |
| `/jobs`, `/settings`, `/profile`, `/admin` | Console, settings, account, operator | Signed in |

Studio sub-routes (`/manage/*`) land in a later phase — see `REDESIGN.md` §2.

### 8.3 The state ladder

Every data surface answers the same five questions with the same primitives:

1. **Pending** → `Skeleton` matching the arriving layout (route-level `pendingComponent`).
2. **Empty** → `EmptyState` with the one action that changes it.
3. **No match** (filters excluded everything) → `EmptyState` + "Clear filters"; never confused with
   empty.
4. **Failed** → `ErrorState` (`panel` in place, `page` for a whole region) with a retry.
5. **Stale** → keep the rows on screen and show the failure above them; never blank a working page.

### 8.4 Voice

Sentence case everywhere, including buttons ("New novel", not "New Novel"). A verb keeps its name
through a flow. Errors say what happened and what to do next — no "Oops", no apology, no exclamation
marks. Button labels name their outcome. Empty states invite. A number that answers a question gets
`text-metric` and a label that asks it ("Needs attention", not "Errors").

---

## 9. Accessibility and responsive contracts

Non-negotiable, checked per surface:

- Skip-to-content as the first focusable element; `main` is the skip target.
- One focus convention (§7.4), visible on cream, dark, sepia and paper.
- Every landmark named; `aria-current` on the active nav item; one `h1` per page.
- 44px minimum targets (§4), 36px only in documented dense contexts.
- Body text ≥4.5:1; borders, icons and status text ≥3:1 against their surface.
- Keyboard-only pass through every flow; focus never trapped outside an overlay.
- `prefers-reduced-motion` honoured without hiding state changes (§6.5).
- One column at 320px, no horizontal scroll, Thai line-breaking intact in both languages.
- Live regions (`role="status"`, `aria-live`) for counts and async results; `role="alert"` for
  destructive notices.

---

## 10. Extending the system

1. Prefer an existing token, variant or primitive. The system is meant to be small.
2. Need a value? Add a token in `globals.css` and document it here in the same change.
3. Need a variation? Add a variant/size/shape to the primitive — never restyle at the call site. If a
   contract entry in `.oxlintrc.json` is genuinely wrong, fix the contract and say why in the commit.
4. New motion? Name the purpose, pick a duration token and an easing token, and add it to §6.2.
5. Verify before claiming it is done:

```bash
bun run generate-routes   # after any route change
bun run lint              # includes the shadcn/* ownership guardrails
bun run typecheck
bun run test              # colocated unit tests
```

`bun run format:check` is part of CI too; on Windows it flags every file whose working-tree line
endings are CRLF (`core.autocrlf=true`), so run `bunx oxfmt --write <paths>` on the files you
touched rather than formatting the whole tree.
