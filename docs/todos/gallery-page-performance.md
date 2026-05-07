# TODO — Gallery page is slow to load

**Status:** open · **Owner:** _unassigned_ · **Filed:** 2026-05-07 by Roi · **Severity:** medium (UX)
**Route:** `/gallery` — `web/src/app/gallery/page.tsx`

---

## Symptom

`/gallery` blocks for several seconds before any HTML renders. No skeleton, no streaming — the user stares at a blank page until every Meta API call resolves on the server.

## Root-cause investigation

The page is an `async` Server Component with `export const dynamic = "force-dynamic"`. On every load it must complete **all** of the following before sending HTML:

| # | Call | Where | Notes |
|---|------|-------|-------|
| 1 | `db.listGalleryAssets(business.id)` | `page.tsx:61` | Local DB. Fast (~ms). |
| 2 | `listAdsWithCreativeAndCampaign(adAcct)` | `page.tsx:72` | Single Graph call, `limit=500`, full creative subobject expansion. ~1–2s. |
| 3 | `listAdInsights(adAcct)` | `page.tsx:73` | Account-level insights, `level=ad`, `limit=500`, **`date_preset=maximum`** (lifetime). ~1–2s. |
| 4 | `listVideoSources(uniqueVideoIds, pageId)` | `page.tsx:87` | **N parallel Graph calls**, one per unique `video_id`. Triggered *after* (2)+(3) complete. ~1–3s depending on count. |
| 5 | `listPagePosts(pageId)` | `page.tsx:106` | Resolves Page Access Token via `/me/accounts` first. ~500ms–1s. |
| 6 | `getInstagramAccountIdForPage(pageId)` | `page.tsx:112` | Sequential after (5). ~300ms. |
| 7 | `listInstagramMedia(igUserId, 50, pageId)` | `page.tsx:116` | Sequential after (6). ~500ms–1s. |

**Total wall time ≈ (2‖3) + 4 + 5 + 6 + 7 ≈ 4–7 seconds.**

### Concrete problems

1. **Serial waterfall between unrelated branches.** The Meta-ads block (2–4) and the organic-feeds block (5–7) share *no* data dependency, but the code awaits them in sequence (`page.tsx:67-95` then `page.tsx:104-123`). They should run in one `Promise.all`.

2. **Organic feeds are themselves serial.** Inside the FB/IG block, `listPagePosts → getInstagramAccountIdForPage → listInstagramMedia` chain sequentially, even though FB posts and IG fetches don't depend on each other (only the IG sub-chain does).

3. **No caching, anywhere.**
   - `cache: "no-store"` on every `graph()` call (`meta.ts:31`).
   - `dynamic = "force-dynamic"` on the page (`page.tsx:25`).
   - No `revalidate`, no `unstable_cache`, no edge cache, no stale-while-revalidate.
   - Every navigation = full set of Graph calls again.

4. **No streaming / no Suspense.** Whole page blocks on the slowest call. No `loading.tsx`. No Suspense boundaries around `<LiveSection>`, `<PrioritySection>`, `<ArchiveSection>` — they could each stream independently.

5. **`listVideoSources` fan-out.** N parallel Graph calls, one per video. Meta supports `?batch=` (up to 50 sub-requests in one HTTPS round-trip). We aren't using it. Also no rate-limit handling — if the account has many videos, we hammer Meta concurrently.

6. **`maximum` insights window is the most expensive.** `INSIGHTS_DEFAULT_RANGE = { preset: "maximum" }` (`meta.ts:318-321`) tells Meta to aggregate every ad over the entire account lifetime. The comment justifies this for the agent's decision loop — but the *gallery UI* may not need lifetime; last-30d would render the same grade A/B/C/D for most ads at a fraction of the cost.

7. **Asset proxy adds RTT to every tile.** Every thumbnail and every organic video URL is rewritten through `/api/gallery/organic-thumbnail?src=...&url=...` (`sections.tsx:144`, `:149`, `:321`). Doubles latency per asset, costs server bandwidth, and (assumed — needs verification) sends no `Cache-Control: public, max-age=…, immutable` header so the browser refetches on every nav. Meta CDN URLs are content-addressed and can safely be cached for hours.

8. **Raw `<img loading="lazy">`, not `next/image`.** Sections render plain `<img>` tags (`sections.tsx:169`, `:366`, `asset-tile.tsx:95`). We lose:
   - Automatic responsive `srcset` (a 1080×1080 thumbnail served to a 200px tile)
   - AVIF/WebP transcoding
   - Built-in blur placeholder
   - Priority hints for above-the-fold tiles

9. **`limit=500` on `/{adAccount}/ads`** (`meta.ts:206`) pulls every ad in the account in one shot with full creative expansion. As Bemtech's account grows past a few hundred ads, this single request will dominate latency. No server-side pagination, no virtualization on the client either.

10. **No `loading.tsx` for `/gallery`.** Even fixing all of the above, adding `web/src/app/gallery/loading.tsx` with a skeleton is the cheapest UX win — perceived performance jumps immediately.

---

## Proposed methods (ordered: highest leverage first)

### 1. Stream the page with Suspense — biggest perceived win

Split the page into independent regions wrapped in `<Suspense>`. Render the shell + `<ActionBar>` immediately, let each section stream in:

```tsx
<Suspense fallback={<LiveSectionSkeleton />}>
  <LiveSectionAsync businessId={business.id} />
</Suspense>
<Suspense fallback={<PrioritySectionSkeleton />}>
  <PrioritySectionAsync businessId={business.id} />
</Suspense>
<Suspense fallback={<ArchiveSectionSkeleton />}>
  <ArchiveSectionAsync businessId={business.id} />
</Suspense>
```

Each `*Async` is its own server component that does only the data it needs. The user sees structure in <500ms instead of staring at blank for 5s. Add `web/src/app/gallery/loading.tsx` for the very first paint.

### 2. Parallelize the two unrelated branches

While streaming is the proper fix, an immediate one-line win: in `page.tsx:67-123`, wrap the Meta-ads block and the organic-feeds block in a single `Promise.all`. Inside each branch, also parallelize what's parallelizable (FB posts can run alongside the IG-account lookup, since the IG-media call is the only one that needs the account id).

### 3. Add a caching layer

Two compatible options, pick based on freshness needs:

- **Per-call `unstable_cache`** with a short TTL + tag-based revalidation:
  ```ts
  const cachedListAds = unstable_cache(
    listAdsWithCreativeAndCampaign,
    ["meta-ads"],
    { revalidate: 120, tags: ["meta-ads"] }
  );
  ```
  Then `revalidateTag("meta-ads")` from the runner trigger endpoint when the agent applies a change.

- **Drop `dynamic = "force-dynamic"` and use `revalidate = 60`** at the page level. Simpler, but coarser — every section refreshes together.

Either way, **remove `cache: "no-store"` from `graph()`** or make it opt-in per call (the runner trigger needs fresh data, the gallery does not).

### 4. Batch the video-source lookups

Replace the N-parallel `listVideoSources` (`meta.ts:333-358`) with Meta's batch API:

```ts
POST https://graph.facebook.com/v21.0/?batch=[{...},{...}]&access_token=...
```

Up to 50 sub-requests per batch round-trip. Reduces 30 sequential Graph hops to 1. Same data, far less latency and rate-limit pressure.

### 5. Cache the asset proxy response

In `web/src/app/api/gallery/organic-thumbnail/route.ts` (verify path), add:

```ts
return new Response(body, {
  headers: {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
  },
});
```

Meta CDN URLs are content-addressed (the `oh=...&oe=...` query params are a signature) — safe to cache aggressively. Eliminates the proxy RTT on repeat visits and on intra-session re-renders.

### 6. Switch to `next/image` for tiles

Replace `<img>` with `<Image>` in `sections.tsx` and `asset-tile.tsx`. Configure `next.config.mjs` `images.remotePatterns` to allow our own `/api/gallery/...` route. Give above-the-fold tiles `priority`, leave the rest with the default lazy. Fixed `width`/`height` props prevent the layout shift we currently get when each tile loads at its own pace.

### 7. Narrow the insights window for the gallery UI

Pass `INSIGHTS_DEFAULT_RANGE = { preset: "last_30d" }` from the gallery call site (or accept a `range` arg on `listAdInsights`, which it already does — just override at call site `page.tsx:73`). Keep `maximum` for the agent's decision loop where the wide signal matters. **Confirm with Roi before changing — there may be ads-as-evergreen winners running > 30 days where lifetime is the right view.**

### 8. Bound the ads payload

`limit=500` is a temporary cap. Real fix:
- Server-side: cursor through `paging.next` with a hard cap (say 200 ads), or filter `effective_status IN ("ACTIVE","PAUSED")` to drop archived.
- Client-side: virtualize the `<ArchiveSection>` grid (it's the longest one) with `react-window` or equivalent so the DOM doesn't render 500 tiles at once.

### 9. Add a `loading.tsx` skeleton

Cheapest win, do it first. Even if nothing else changes, the user sees structure instantly.

---

## Directives for whoever picks this up

- **Measure before and after.** Use Chrome DevTools Network panel + Server Timing headers. Capture: TTFB, total HTML wall time, time-to-largest-section. Note them in the PR description so we know the win was real.
- **Don't break the agent's loop.** `listAdInsights` is also called by the Python tools (verify via `grep -r "listAdInsights"`). If you narrow the default window, do it at the gallery's call site, not in `meta.ts`.
- **Don't bypass the asset proxy.** The `Referer`-stripping is load-bearing — Meta CDN 403s without it. Keep the proxy, just cache it properly.
- **Respect the dual-mode adapter rule** (`web/src/lib/CLAUDE.md`). Any DB changes go through `getDataClient()`, never `pg` directly.
- **Hebrew strings stay Hebrew.** Skeletons and loading states in `loading.tsx` should match the existing `<PageHeader eyebrow="גלריה">` voice.
- **Land it in slices.** Don't ship one mega-PR. Suggested slice order:
  1. `loading.tsx` + Suspense streaming (no API changes) — biggest perceived win, lowest risk
  2. Parallelize the two server-side branches + drop `cache: "no-store"` for gallery calls
  3. `unstable_cache` wrappers + tag-based revalidation
  4. Asset proxy `Cache-Control` headers
  5. Batch `listVideoSources` via Meta `?batch=`
  6. `next/image` migration
  7. Insights window + ads-payload bounding (needs Roi sign-off — semantic change)

## Files most likely to change

- `web/src/app/gallery/page.tsx` (split into Suspense-bounded async children)
- `web/src/app/gallery/loading.tsx` (new — skeleton)
- `web/src/lib/meta.ts` (cache wrappers, batch endpoint, default cache policy)
- `web/src/app/api/gallery/organic-thumbnail/route.ts` (Cache-Control)
- `web/src/app/gallery/sections.tsx` + `asset-tile.tsx` (next/image migration)
- `web/next.config.mjs` (images.remotePatterns for the proxy route)
