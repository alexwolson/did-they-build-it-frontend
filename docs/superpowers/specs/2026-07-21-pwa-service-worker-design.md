# PWA: service worker + web manifest + install icons

**Issue:** #31
**Date:** 2026-07-21
**Status:** Approved (design)

## Goal

Turn the app into an installable PWA so field volunteers on flaky venue networks get
instant repeat loads, an offline-capable shell, and a standalone home-screen launch.
The app already has an offline submission queue; this adds the caching + install layer
around it.

### Acceptance criteria (from #31)

- Repeat load works offline: the app shell + last-seen sites render with no network.
- Installable to the home screen on both iOS and Android in standalone mode.
- `/api/*` submissions still hit the network and are never served from cache.

## Non-goals (YAGNI)

- No update prompt/toast — updates apply silently on next load.
- No offline banner UI — the existing `pendingSync`/Toast already signals sync state.
- No Background Sync API — the existing localStorage queue + interval flush covers offline submits.
- No push notifications.
- No tile precaching — tiles are runtime-cached only, as visited.

## Architecture

Hand-rolled service worker (approach A), no new dependencies, using SvelteKit's
built-in `$service-worker` module. SvelteKit auto-registers `src/service-worker.ts`.
The Cloudflare adapter emits it at `/service-worker.js` with root scope.

Rationale for hand-rolled over `@vite-pwa/sveltekit`/Workbox: the caching logic is
three rules; a ~40-line hand-written SW is more transparent and debuggable on a
flaky-network field app than a Workbox config layer, and adds no dependency —
consistent with the app's lean ethos.

### Components

1. `src/service-worker.ts` — the worker: cache buckets, install/activate lifecycle,
   fetch routing. Imports pure helpers below so the routing/eviction logic is testable.
2. `src/lib/sw-helpers.ts` — pure, unit-testable functions:
   - `classifyRequest(url, requestMethod)` → a route category
     (`'bypass' | 'navigate' | 'immutable' | 'data' | 'tiles' | 'passthrough'`).
   - `trimToCap(cache, max)` → LRU-evicts oldest entries beyond `max` (oldest = first
     `cache.keys()` order, which is insertion order per the Cache API).
3. `static/manifest.webmanifest` — the web app manifest.
4. `src/app.html` — `<head>` links + Apple meta tags.
5. `static/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`
   — generated install icons.
6. `scripts/generate-icons.mjs` — reproducible icon generator (run once, PNGs committed).

## Service worker detail

### Cache buckets

- `shell-<version>` — precached on `install`: all hashed `build` assets (includes the
  maplibre chunk) + static `files`. This is what makes repeat loads instant and the
  shell work offline. `<version>` is the `$service-worker` `version` export.
- `data-<version>` — runtime, stale-while-revalidate, for `/data/sites.json`.
- `tiles` — runtime, **not** version-scoped (survives deploys — tiles are URL-hashed and
  expensive to refetch), stale-while-revalidate, **hard-capped at 250 entries, LRU-evict**.
  Covers `tiles.openfreemap.org` tiles, sprite, glyphs, and style JSON.

### Fetch routing

Classified by `classifyRequest`:

- `bypass` — `/api/*` (any method): return without calling `respondWith`, so the request
  goes straight to network. Submissions/status must never be cached; the offline queue
  owns failures.
- `navigate` — HTML navigation requests: **network-first**; cache each successful
  navigation response into `shell-<version>`. On network failure, serve the cached
  response for **this exact URL**, and if that misses, fall back to the cached `/`
  (so any deep-linked route still boots the SPA offline, which then client-routes).
  Note: this app is SSR on Cloudflare — there is no static `index.html` to precache,
  so the offline shell is a runtime-cached copy of a previously-fetched navigation.
- `immutable` — same-origin `build`/`files` (content-hashed): **cache-first**.
- `data` — `/data/sites.json`: **stale-while-revalidate** (serve cache immediately,
  refresh in background) in `data-<version>`.
- `tiles` — cross-origin GET to `tiles.openfreemap.org`: **stale-while-revalidate** in
  `tiles`, then `trimToCap(tiles, 250)`.
- `passthrough` — everything else: plain `fetch`, no caching.

Only `GET` requests with `response.ok` are written to a cache. openfreemap sends CORS
headers (we already `preconnect crossorigin`), so tile responses are non-opaque and
safely cacheable/countable.

### Lifecycle

- `install`: open `shell-<version>`, `addAll([...build, ...files])`. Do **not** call
  `skipWaiting()`.
- `activate`: delete any cache whose name is not the current `shell-<version>`,
  `data-<version>`, or `tiles`; then `clients.claim()`.

### Update behavior

Silent auto-update. No `skipWaiting`, so a new SW waits and activates on the next full
load / when old clients are gone — never swapping hashed chunks mid-session (avoids
chunk-mismatch bugs). First-ever visit has no old SW, so it activates immediately and
`clients.claim()`s (SW control without a reload). Users get a new version the next time
they open the app.

## Manifest — `static/manifest.webmanifest`

```json
{
  "name": "Did They Build It?",
  "short_name": "Build It?",
  "description": "Check whether Toronto developers built what their approvals promised.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#eff6f1",
  "theme_color": "#0f766e",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`background_color` = `--paper`; `theme_color` = the existing `theme-color` meta.

## `<head>` additions — `src/app.html`

- `<link rel="manifest" href="/manifest.webmanifest" />`
- `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`
- `<meta name="apple-mobile-web-app-capable" content="yes" />`
- `<meta name="mobile-web-app-capable" content="yes" />`
- `<meta name="apple-mobile-web-app-status-bar-style" content="default" />`
  (safer than `black-translucent` given the top safe-area insets added in #35)
- `<meta name="apple-mobile-web-app-title" content="Build It?" />`

`theme-color` already present.

## Icons — `scripts/generate-icons.mjs` (sharp)

Compose a flat SVG (teal `#0fa98e` background + centered white checkmark path — the
verification action; no emoji, on-identity) and rasterize:

- `icon-192.png`, `icon-512.png` — check at ~55% of canvas.
- `icon-512-maskable.png` — **full-bleed teal**, check at ~45% (inside Android's 80%
  maskable safe zone, so masks never clip it).
- `apple-touch-icon.png` (180×180) — full-bleed square, no transparency (iOS applies its
  own corner radius; we don't pre-round).

Script committed for reproducibility; the PNGs are committed as static assets so there's
no icon step in the build pipeline.

## Offline UX

No new app UI. The SW alone delivers it: cached shell boots → SvelteKit SPA hydrates →
`loadSites()` reads `/data/sites.json` from the SW cache → pins render → previously-seen
tiles render (unseen areas are blank). Sync state is already surfaced by `pendingSync`
and the Toast.

## Testing

- **Unit (vitest):** `classifyRequest` (each category incl. `/api/*` bypass and the
  tiles host) and `trimToCap` (evicts down to the cap, keeps newest). These are the only
  non-event-driven logic.
- **Manual / on-device:**
  - Android: install prompt → standalone launch.
  - iOS: Add to Home Screen → standalone launch; top controls + safe-area correct
    without the browser URL bar.
  - Offline (DevTools → Application → offline): repeat load boots the shell + pins;
    seen map areas render.
  - `/api/*` POSTs are never served from cache (verify in DevTools Network/Application).
  - Tile cap holds: pan widely, confirm the `tiles` cache stays ≤ 250 entries.
  - Confirm the Cloudflare adapter serves `/service-worker.js` at root scope after deploy.

## Risks / notes

- The Cloudflare adapter + SW: confirm the SW ships and registers at root scope on the
  real edge (a preview deploy check). The known SSR self-fetch 1042 gotcha is server-side
  only; the SW runs in the browser and is unaffected.
- `trimToCap` runs after each tile write; keep it cheap (only trims when over cap).
- `apple-mobile-web-app-capable` is legacy but still required for iOS standalone; paired
  with the standard `mobile-web-app-capable`.
