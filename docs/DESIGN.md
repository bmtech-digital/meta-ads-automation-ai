# Campaigner — Visual Design Language

> Living reference for how the Campaigner web surface should *look and feel*.
> Distilled from the two sibling Bemtech projects so we don't drift away from
> the family resemblance.

## Sibling projects we mirror

| Project | What it is | What we borrow |
|---|---|---|
| **`bemtech/aiweon`** (`frontend/`, the campaigners' marketing + auth site at `weon.co.il`) | React + CRA, RTL Hebrew, dark-by-default, single brand color | full color system, glass surfaces, glow shadows, gradient hover, header geometry |
| **`bemtech/generic_agent`** (`dashboard/`, the agent platform's authenticated app) | React + Vite + TS + Tailwind, RTL Hebrew, sidebar layout | density rules, focus-ring conventions, mobile drawer pattern |

Campaigner is **closer to `aiweon` than to `generic_agent`**: a top-nav, marketing-adjacent product surface that happens to host data tables. Use the aiweon header geometry; borrow generic_agent's density only where it pays.

## North-star feeling

> Premium dark interior with a single warm accent — Aiweon orange — used
> sparingly on actions, focus rings, brand glows and active states.
> Surfaces breathe with subtle radial light, not flat grey rectangles.

The screenshot Roi flagged (settings → users card with a thin amber glow) is the
target intensity: **the page is dark, but it's not dead.** Cards and active
elements pick up a warm border-tint or a soft glow; the rest of the surface
stays calm.

## Color tokens

| Token | Light | Dark | Source |
|---|---|---|---|
| `--background` | `30 25% 99%` (warm cream) | `33 10% 6%` (`#0F0E0D`) | already in `globals.css` ✓ |
| `--card` | white | `33 8% 9%` (`#171513`) | already in `globals.css` ✓ |
| `--primary` (Aiweon orange) | `33 93% 54%` (`#F7941D`) | `33 93% 56%` | aiweon's `--color-primary` |
| `--ring` | matches primary | matches primary | already in `globals.css` ✓ |
| `--border-accent` (warm overlay) | `rgba(247,148,29,0.30)` | `rgba(247,148,29,0.30)` | aiweon's `--border-accent` — **adopt** |
| `--brand-glow` (focus glow) | `0 0 0 3px rgba(247,148,29,0.28)` | same | already in tailwind config ✓ |

**Palette discipline.** Aiweon orange is the only chromatic accent. Status
colors (success / warning / destructive) appear when they carry data meaning
— never decoratively. No teal, no purple, no second brand color creeps in.
Generic_agent's badges have the same restraint; we keep it.

## Surface system

Three layers of darkness in dark mode. Use them deliberately:

| Layer | Token | Where |
|---|---|---|
| Base | `--background` | the page itself, gallery wells |
| Elevated | `--card` | every card, modal, input |
| Glass | `hsl(var(--background) / 0.72)` + `backdrop-filter: blur(12px)` | header, sticky filter bars |

Aiweon's contribution: **subtle radial wash on the page itself**, so even a
blank section feels lit:

```css
.dark body {
  background-image: radial-gradient(
    ellipse 900px 480px at 95% -10%,
    hsl(33 93% 56% / 0.07),
    transparent 70%
  );
  background-attachment: fixed;
}
```

Already in `globals.css`. **Extend it** with a second wash on the opposite side
for routes that read busy (gallery, settings) — same hue, lower opacity, mirrored.

### Card glow utility

Per the screenshot, cards that represent a *unit* (a user, a campaign, an
approval) should pick up a hairline warm border on hover:

```css
.card-warm {
  border-color: hsl(var(--border));
  transition: border-color 200ms, box-shadow 200ms, transform 200ms;
}
.card-warm:hover {
  border-color: rgba(247, 148, 29, 0.30);
  box-shadow: 0 0 0 1px rgba(247, 148, 29, 0.18), 0 8px 24px rgba(247, 148, 29, 0.10);
}
.card-warm[data-emphasis="active"] {
  border-color: rgba(247, 148, 29, 0.45);
  box-shadow: 0 0 0 1px rgba(247, 148, 29, 0.25), 0 12px 32px rgba(247, 148, 29, 0.12);
}
```

Use `data-emphasis="active"` for the *one* card the user is acting on — the
selected user, the current approval. Don't sprinkle it everywhere; the whole
point is that the warm glow draws the eye.

## Typography

Three families, each loaded once in `layout.tsx` via `next/font`:

| Use | Family | CSS variable |
|---|---|---|
| Hebrew display + UI | **Assistant** | `var(--font-assistant)` |
| Latin sans (auto-blends with Assistant per-glyph) | **Geist** | `var(--font-geist)` |
| Numbers, Meta IDs, code, mono | **Geist Mono** | `var(--font-geist-mono)` |

Heebo was the previous brand font and is no longer used. Assistant has
contemporary letter shapes that pair cleanly with Geist's Latin grade at
small sizes — that's the AI-premium voice the brand reads for. Browser
picks per-glyph; in `tailwind.config.ts` we list Assistant first as the
default-hint, Geist second.

Display sizes already tightened in `tailwind.config.ts`:

| Class | Use |
|---|---|
| `text-display` | hero only |
| `text-h1` | page title |
| `text-h2` | section heading |
| `text-h3` | subsection / card title |
| body (default 14.5–15px) | most copy |
| `text-[11px] tracking-[0.16em] uppercase` | eyebrows above page titles |

**Hebrew + Latin together rule** (from generic_agent): wrap any inline Latin
fragment (Meta IDs, emails, URLs) in `dir="ltr"` — never let bidi-resolution
flip it for you.

## Header

Match aiweon's header geometry, not its colors (we stay dark by default):

| Property | Value | Source |
|---|---|---|
| Height | 64px (`h-16`) | current ✓, matches aiweon's 80px scaled for app density |
| Background | `hsl(var(--background) / 0.72)` + 12px blur | aiweon `.header { background: rgba(255,255,255,0.95); backdrop-filter: blur(10px) }` adapted to dark |
| Border | hairline `--border` bottom only | aiweon shadow → we use border |
| Active link | gradient underline (already wired as `.nav-link-underline`) | direct port from aiweon |
| Logo | full wordmark, not just mark, at `size={30}` with `subtitle="Campaigner"` | matches aiweon Header.js with the "Campaigner" subtitle as the product disambiguator |
| Mobile | sheet drawer from `end` side (RTL: right) | generic_agent's `DashboardLayout` pattern |

**The subtitle pattern** (`AiweonLogo subtitle="Campaigner"`) is load-bearing —
it visually says "this is the Campaigner *inside* Aiweon", which is the actual
product positioning. Don't drop it.

## Buttons

aiweon defines two header-action variants we should keep available:

| Variant | shadcn equivalent | When |
|---|---|---|
| `btn-header-primary` | `<Button>` (filled, brand) | the **one** primary CTA per page (Run now, Approve) |
| `btn-header-outline-orange` | `<Button variant="outline">` | secondary actions inline with the primary |
| `btn-header-glass` | `<Button variant="ghost">` | tertiary actions, theme toggle, user menu |

Hover lifts: aiweon uses `transform: translateY(-1px) + box-shadow: 0 8px 24px rgba(247,148,29,0.35)`.
Already wired as `.bg-brand-gradient-hover`. Use it on every brand-filled button.

## Motion

Three transitions, all cubic-bezier(0.4, 0, 0.2, 1):

| Speed | Use |
|---|---|
| 150ms (`fast`) | hover, focus, color changes |
| 250ms (`normal`) | drawer / sheet open/close |
| 400ms (`slow`) | full theme switch |

Already declared as CSS vars in aiweon's `index.css`; we should hoist a
matching set into our `globals.css` so feature components don't re-invent.

## Iconography

`lucide-react` for app actions (current convention ✓). Aiweon uses
`react-icons/fi` — don't switch; lucide is the cleaner family for an app
surface. Keep them at 16px in nav, 18px in mobile sheet, 14px in inline pill
chips.

## RTL discipline (from generic_agent's playbook)

1. Default direction is `rtl`. Set in `<html>`, never on a child container.
2. Use logical properties: `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`. Never `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`.
3. Latin numerals + IDs go in a `dir="ltr"` span. The `mono-ltr` class is already there for IDs and budgets.
4. Mobile drawer slides from `end` side. RTL → from the right. Don't hardcode `right-0`.

## What we deliberately don't borrow

| From | What | Why |
|---|---|---|
| aiweon `frontend/` | hand-written CSS modules per component | we're shadcn + Tailwind only — class-first, single `globals.css`. Don't create `*.css` files. |
| aiweon `frontend/` | React 18 `react-router-dom` patterns | we're Next.js App Router; routing is filesystem |
| generic_agent `dashboard/` | left sidebar layout | we're a top-nav product. The sidebar is right for an "app within an app" (chat + abilities + onboarding). Campaigner is shallower — top nav with 5–7 destinations stays scannable in Hebrew RTL. |
| generic_agent `dashboard/` | `@react-oauth/google`, `react-i18next`, `recharts` | scope creep. We render charts on demand if needed, not by adopting a chart lib upfront. |

## Decision rule when adding visuals

1. Does aiweon already do this? Mirror it — same tokens, same shadow stack, same hover lift.
2. Does generic_agent solve it differently? Pick the one that *reads better in dark RTL Hebrew at the density we need*. If aiweon wins, take aiweon. If generic_agent wins, take generic_agent. Don't blend.
3. Neither has it? Add it under `globals.css` with a one-line comment explaining what it's for. If a feature component needs a one-off style, push it into the global layer first so the next reuse is free.

## SubNav pattern

Top Nav consolidated 12 → 8 in the 2026-05-17 redesign. Three of those eight
items group siblings into a single Top Nav entry, with secondary navigation
between siblings via `<SubNav>`:

| Top Nav | Group members | SubNav |
|---|---|---|
| קמפיינים | `/campaigns` · `/ab-tests` · `/plans` | קמפיינים · מבחני A/B · תוכניות הרצה |
| קהל ולידים | `/audiences` · `/leads` | קהלים · לידים |
| הגדרות | `/settings` · `/integrations` | כללי · אינטגרציות |

`<SubNav>` lives in `web/src/components/sub-nav.tsx` with three exported
group constants (`CAMPAIGN_GROUP_ITEMS`, `AUDIENCE_GROUP_ITEMS`,
`SETTINGS_GROUP_ITEMS`). Each grouped page sets `<Shell active="/parent">`
(not its own route) so the Top Nav pill highlights the group; the SubNav
itself uses `usePathname()` with **exact-match for `/` and
prefix-with-slash for everything else** (`pathname === href ||
pathname.startsWith(href + "/")`) to highlight the active sibling.

In-page TABS (filter pills inside `/audiences`, `/leads`, `/ab-tests`,
`/history`) sit **below** the SubNav and remain orthogonal — SubNav
switches routes, TABS filter within a route. Don't merge them.

## Learning state for live creatives

A live ad whose Meta insights snapshot hasn't yet accumulated 1,000
impressions has `ctr`, `hook_rate`, and `spend` all `null` in
`asset.performance_snapshot`. The naive `(ctr != null || hook_rate != null
|| spend != null)` metrics row in `asset-tile.tsx` silently disappears
in that case, leaving the operator no indication of state.

The fix is a brand-orange pill placed where the metrics row would have
been, shown only when **lifecycle = "live"** AND all three metrics are
null. Copy: `אוסף נתונים — פחות מ-1,000 חשיפות עדיין`. The dot pulses
(`animate-pulse-soft`) to mark the asset as actively gathering signal.

This pairs with `PerformanceGrade = "learning"` in
`web/src/app/gallery/scoring.ts` — both share the same 1,000-impression
threshold; if you move that threshold, update both.

## Files this doc binds

- `web/src/app/globals.css` — token + utility source of truth
- `web/tailwind.config.ts` — type scale, color, shadow, animation extensions
- `web/src/components/nav.tsx` — header geometry (8 Top Nav items + right-pill Search/Bell)
- `web/src/components/sub-nav.tsx` — secondary navigation between sibling routes
- `web/src/components/brand/logo.tsx` — wordmark contract
- `web/src/components/shell.tsx` — page shell, max-widths, page-header eyebrow rule
- `web/src/app/gallery/asset-tile.tsx` — gallery card with learning state pill
- `web/src/app/gallery/scoring.ts` — Lifecycle and PerformanceGrade contract (shared with the agent)

When any of these drift from this doc, update *the doc* — this file lags
intentionally so it captures decisions, not in-progress experiments.
