# Brand assets — Aiweon

Drop the originals here with these exact names:

| File | Purpose | Size |
|---|---|---|
| `aiweon-logo.png` | Full logo (wordmark + tagline) | 1600 × 1000 source |
| `aiweon-wordmark.svg` | Wordmark only (Ai + weOn), transparent | — |
| `aiweon-mark.svg` | Just the orange "Ai" mark, transparent | — |

Used by:
- `web/src/components/brand/logo.tsx` — the `<AiweonLogo>` component
- `web/src/app/icon.png` — favicon (generate from `aiweon-mark.svg`)
- `web/src/app/opengraph-image.png` — OG image (1200 × 630)

Currently the code has an SVG fallback that works without these files, but dropping the real assets here will swap to the originals automatically.
