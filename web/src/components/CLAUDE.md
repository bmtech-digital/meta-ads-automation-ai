# Claude-at-`web/src/components/` — UI components

> Loaded automatically when cwd is here. Active alongside [`../../CLAUDE.md`](../../CLAUDE.md) and [root CLAUDE.md](../../../CLAUDE.md).

## What this folder is

Two layers, separated on purpose:

| Layer | Folder | Origin | What goes here |
|---|---|---|---|
| Primitives | [`ui/`](ui/) | shadcn/ui starter | Button, Card, Input, Label, Badge, Dialog, Sheet, Dropdown — generic building blocks |
| Feature components | this folder (top-level) | hand-written | App-specific composites: nav, shell, theme-toggle, decision-row, budget-health-card |

## Don't mix the layers

- Generic primitives (a colored badge, a re-skinned input) go in `ui/` and follow shadcn conventions: forwardRef, `cn()` for class composition, `cva` for variants, `data-state` attributes for interactive states.
- App-specific components (a row that renders one `agent_decisions` entry, a card that shows a campaign's budget pacing) live at this folder's top level. They compose primitives from `ui/`; primitives don't know about agent decisions.

If you find yourself adding domain knowledge to `ui/Button` ("orange when budget exceeded"), it belongs in a wrapper at the top level, not inside the primitive.

## Current feature components

| File | Renders | Reads data via |
|---|---|---|
| [`nav.tsx`](nav.tsx) | Top nav with logo, ad-account switcher, links | server-component caller passes data |
| [`shell.tsx`](shell.tsx) | Page chrome wrapping nav + main + RTL container | — |
| [`decision-row.tsx`](decision-row.tsx) | One `agent_decisions` row, formatted | parent passes the row |
| [`budget-health-card.tsx`](budget-health-card.tsx) | Per-campaign pacing + utilization | parent passes the metrics |
| [`last-scan-card.tsx`](last-scan-card.tsx) | Home-page summary of latest `observe_propose` run — gate chips (budget/tracking/account) + top finding + CTA to `/runs/[run_id]`. Uses [`../lib/runs-summary.ts`](../lib/runs-summary.ts). | parent passes the `RunSummaryRow` + full decision trail |
| [`run-now-button.tsx`](run-now-button.tsx) | Triggers a runner via `/api/runners/trigger/` | client component, `fetch` |
| [`theme-provider.tsx`](theme-provider.tsx) / [`theme-toggle.tsx`](theme-toggle.tsx) | Dark mode | client component, localStorage |
| [`user-menu.tsx`](user-menu.tsx) | Profile dropdown, logout | parent passes user info |
| [`brand/`](brand/) | Logo + brand assets | static |

## Conventions

1. **Per file: one component, named-exported.** `export function Nav() {}`. No default exports — easier to grep and refactor.
2. **`"use client"` only when needed.** Theme toggle, run-now-button, anything with state — yes. Decision-row, budget-card — no.
3. **Tailwind classes in JSX**, not in separate `.module.css`. Use `cn(...)` from [`../lib/utils.ts`](../lib/utils.ts) for conditional classes.
4. **shadcn primitives** — installed by copying into `ui/`, not by npm install. To add a new one, run shadcn's add command (or copy manually) and commit the file. Don't introduce a new component library.
5. **RTL-aware spacing.** Use Tailwind logical properties (`ms-2`, `me-2`, `ps-4`) instead of `ml-/mr-/pl-/pr-`. RTL is the default; LTR helpers leak.
6. **No `forwardRef` outside `ui/`.** Feature components don't need ref forwarding. If you think you do, the primitive should expose what's needed.

## Adding a new component

- Pick the right layer (see "Don't mix the layers" above).
- Server component if it can be — every `"use client"` ships JS to the browser.
- Props are typed (no `any`). Use Zod-derived types from [`../lib/schemas/`](../lib/schemas/) when the component renders DB data.
- Add a Vitest test only for components with non-trivial logic (formatting, derived state). Pure render components don't need tests — Playwright covers them at the route level.

## Where truth lives

| Question | Read |
|---|---|
| shadcn/ui conventions | [shadcn docs](https://ui.shadcn.com) (external) |
| Tailwind tokens (colors, fonts) | [`../../tailwind.config.ts`](../../tailwind.config.ts), [`../app/globals.css`](../app/globals.css) |
| Brand assets | [`../../public/brand/README.md`](../../public/brand/README.md) |
| What data fields a component renders | [`../lib/db/types.ts`](../lib/db/types.ts) |
