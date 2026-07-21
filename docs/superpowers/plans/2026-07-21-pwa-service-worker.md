# PWA Service Worker + Manifest + Install Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the app into an installable PWA — instant repeat loads, an offline-capable shell, and standalone home-screen launch — around the existing offline submission queue.

**Architecture:** Hand-rolled service worker (no dependencies) on SvelteKit's built-in `$service-worker` module. Routing/eviction logic lives in a pure, unit-tested helper module; the worker itself wires Cache-API strategies to those decisions. A web manifest + Apple meta tags enable install; flat brand icons are generated once with `sharp` and committed.

**Tech Stack:** SvelteKit 2 (`$service-worker`), `@sveltejs/adapter-cloudflare`, TypeScript, vitest, `sharp` (dev-only, for icon generation).

## Global Constraints

- No new **runtime** dependencies — the service worker is hand-rolled. `sharp` is dev-only; its output PNGs are committed, so builds never need it.
- `/api/*` requests are **network-only, never cached** (any method).
- Tile cache is **hard-capped at 250 entries**, LRU-evicted; the tiles bucket is **not** version-scoped (survives deploys).
- Manifest copy (verbatim): `name` = `"Did They Build It?"`, `short_name` = `"Build It?"`, `theme_color` = `#0f766e`, `background_color` = `#eff6f1`, `display` = `standalone`, `orientation` = `portrait`.
- Icon art: teal `#0fa98e` + white checkmark. **No emoji.**
- Cloudflare adapter; the SW must serve at `/service-worker.js` with root scope.
- Repo style: **tab** indentation; tests live in `tests/unit/` and run under vitest.
- `/data/sites.json` is stale-while-revalidate, **not** treated as an immutable precache entry (even though it appears in `files`).

---

## Task 1: Pure service-worker helpers (`classifyRequest`, `trimToCap`)

**Files:**
- Create: `src/lib/sw-helpers.ts`
- Test: `tests/unit/sw-helpers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RequestClass = 'bypass' | 'navigate' | 'immutable' | 'data' | 'tiles' | 'passthrough'`
  - `classifyRequest(input: { url: URL; method: string; isNavigate: boolean; sameOrigin: boolean; precached: Set<string>; tilesHost: string }): RequestClass`
  - `trimToCap(cache: Pick<Cache, 'keys' | 'delete'>, max: number): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sw-helpers.test.ts`:

```ts
// tests/unit/sw-helpers.test.ts
import { describe, expect, it } from 'vitest';
import { classifyRequest, trimToCap, type RequestClass } from '../../src/lib/sw-helpers';

const base = {
	sameOrigin: true,
	isNavigate: false,
	method: 'GET',
	precached: new Set<string>(['/_app/immutable/chunks/x.js', '/favicon.svg', '/data/sites.json']),
	tilesHost: 'tiles.openfreemap.org'
};

function classify(over: Partial<Parameters<typeof classifyRequest>[0]> & { url: string }): RequestClass {
	const { url, ...rest } = over;
	return classifyRequest({ ...base, ...rest, url: new URL(url) });
}

describe('classifyRequest', () => {
	it('bypasses /api/* for any method', () => {
		expect(classify({ url: 'https://app.dev/api/submissions', method: 'POST' })).toBe('bypass');
		expect(classify({ url: 'https://app.dev/api/status', method: 'GET' })).toBe('bypass');
	});

	it('routes navigations to navigate', () => {
		expect(classify({ url: 'https://app.dev/site/abc', isNavigate: true })).toBe('navigate');
	});

	it('routes /data/sites.json to data even though it is in the precache set', () => {
		expect(classify({ url: 'https://app.dev/data/sites.json' })).toBe('data');
	});

	it('routes openfreemap requests to tiles', () => {
		expect(classify({ url: 'https://tiles.openfreemap.org/planet/14/1/2.pbf', sameOrigin: false }))
			.toBe('tiles');
	});

	it('routes same-origin precached hashed assets to immutable', () => {
		expect(classify({ url: 'https://app.dev/_app/immutable/chunks/x.js' })).toBe('immutable');
	});

	it('passes through non-GET non-api requests', () => {
		expect(classify({ url: 'https://app.dev/data/sites.json', method: 'POST' })).toBe('passthrough');
	});

	it('passes through unknown cross-origin and unmatched same-origin', () => {
		expect(classify({ url: 'https://example.com/thing.js', sameOrigin: false })).toBe('passthrough');
		expect(classify({ url: 'https://app.dev/not-cached' })).toBe('passthrough');
	});
});

describe('trimToCap', () => {
	function fakeCache(urls: string[]) {
		const order = [...urls];
		return {
			deleted: [] as string[],
			async keys() {
				return order.map((u) => new Request(u));
			},
			async delete(req: Request) {
				const i = order.indexOf(req.url);
				if (i >= 0) order.splice(i, 1);
				(this.deleted as string[]).push(req.url);
				return true;
			}
		};
	}

	it('does nothing when at or under the cap', async () => {
		const c = fakeCache(['https://t/1', 'https://t/2']);
		await trimToCap(c, 2);
		expect(c.deleted).toEqual([]);
	});

	it('evicts the oldest entries (front of insertion order) down to the cap', async () => {
		const c = fakeCache(['https://t/1', 'https://t/2', 'https://t/3', 'https://t/4']);
		await trimToCap(c, 2);
		expect(c.deleted).toEqual(['https://t/1', 'https://t/2']);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/sw-helpers.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/sw-helpers` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/lib/sw-helpers.ts`:

```ts
// Pure, unit-testable decisions for the service worker (src/service-worker.ts).
// Kept out of the worker so the routing + eviction logic can be tested without
// the event-driven Cache API.

export type RequestClass = 'bypass' | 'navigate' | 'immutable' | 'data' | 'tiles' | 'passthrough';

const SITES_JSON = '/data/sites.json';

export function classifyRequest(input: {
	url: URL;
	method: string;
	isNavigate: boolean;
	sameOrigin: boolean;
	precached: Set<string>;
	tilesHost: string;
}): RequestClass {
	const { url, method, isNavigate, sameOrigin, precached, tilesHost } = input;

	// /api/* is always network-only, regardless of method — the offline queue owns it.
	if (sameOrigin && url.pathname.startsWith('/api/')) return 'bypass';

	// Only GET responses are ever cached; everything else goes straight to network.
	if (method !== 'GET') return 'passthrough';

	if (isNavigate) return 'navigate';

	// sites.json is checked BEFORE the precache set: it appears in `files` (so it is
	// in `precached`), but it must be stale-while-revalidate, not cache-first.
	if (sameOrigin && url.pathname === SITES_JSON) return 'data';

	if (url.host === tilesHost) return 'tiles';

	if (sameOrigin && precached.has(url.pathname)) return 'immutable';

	return 'passthrough';
}

// LRU-evict a cache down to `max` entries. cache.keys() returns Requests in
// insertion order, so the front is oldest. Only trims when over the cap.
export async function trimToCap(cache: Pick<Cache, 'keys' | 'delete'>, max: number): Promise<void> {
	const keys = await cache.keys();
	if (keys.length <= max) return;
	const excess = keys.length - max;
	for (let i = 0; i < excess; i++) {
		await cache.delete(keys[i]);
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/sw-helpers.test.ts`
Expected: PASS (9 assertions across 2 suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sw-helpers.ts tests/unit/sw-helpers.test.ts
git commit -m "feat(pwa): pure service-worker routing + cache-trim helpers"
```

---

## Task 2: The service worker (`src/service-worker.ts`)

**Files:**
- Create: `src/service-worker.ts`

**Interfaces:**
- Consumes: `classifyRequest`, `trimToCap`, `RequestClass` from `$lib/sw-helpers`; `build`, `files`, `version` from `$service-worker`.
- Produces: the registered service worker (no importable surface).

- [ ] **Step 1: Write the service worker**

Create `src/service-worker.ts`:

```ts
/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';
import { classifyRequest, trimToCap, type RequestClass } from '$lib/sw-helpers';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL = `shell-${version}`;
const DATA = `data-${version}`;
const TILES = 'tiles'; // NOT version-scoped: tiles are URL-hashed and survive deploys
const TILES_HOST = 'tiles.openfreemap.org';
const TILE_CAP = 250;

// Precache the hashed app shell. Exclude /data/sites.json — it is served by the
// stale-while-revalidate `data` strategy, not treated as an immutable asset.
const PRECACHE = [...build, ...files].filter((path) => path !== '/data/sites.json');
const PRECACHE_SET = new Set([...build, ...files]);

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
	// No skipWaiting: a new worker waits and activates on the next full load, so we
	// never swap hashed chunks under a running session.
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== SHELL && key !== DATA && key !== TILES) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	const cls = classifyRequest({
		url,
		method: request.method,
		isNavigate: request.mode === 'navigate',
		sameOrigin: url.origin === sw.location.origin,
		precached: PRECACHE_SET,
		tilesHost: TILES_HOST
	});

	// bypass (/api/*) and passthrough: do not intercept — straight to network.
	if (cls === 'bypass' || cls === 'passthrough') return;

	event.respondWith(handle(cls, request));
});

async function handle(cls: RequestClass, request: Request): Promise<Response> {
	if (cls === 'immutable') {
		const cache = await caches.open(SHELL);
		const cached = await cache.match(request);
		if (cached) return cached;
		const res = await fetch(request);
		if (res.ok) await cache.put(request, res.clone());
		return res;
	}

	if (cls === 'navigate') {
		const cache = await caches.open(SHELL);
		try {
			const res = await fetch(request);
			if (res.ok) await cache.put(request, res.clone());
			return res;
		} catch {
			// Offline: serve this exact URL if cached, else fall back to cached "/"
			// so any deep-linked route still boots the SPA (which then client-routes).
			return (
				(await cache.match(request)) ??
				(await cache.match('/')) ??
				Response.error()
			);
		}
	}

	if (cls === 'data') return staleWhileRevalidate(request, DATA);
	if (cls === 'tiles') return staleWhileRevalidate(request, TILES, TILE_CAP);

	return fetch(request);
}

async function staleWhileRevalidate(
	request: Request,
	cacheName: string,
	cap?: number
): Promise<Response> {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	const network = fetch(request)
		.then(async (res) => {
			if (res.ok) {
				await cache.put(request, res.clone());
				if (cap) await trimToCap(cache, cap);
			}
			return res;
		})
		.catch(() => undefined);
	return cached ?? (await network) ?? Response.error();
}
```

- [ ] **Step 2: Type-check the worker**

Run: `npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json`
Expected: `0 ERRORS` (pre-existing warnings unrelated to these files are fine). This confirms `$service-worker`, the `webworker` lib, and the `$lib/sw-helpers` import all resolve.

- [ ] **Step 3: Build and confirm the worker is emitted**

Run: `npx vite build && ls .svelte-kit/cloudflare/service-worker.js`
Expected: build succeeds; `service-worker.js` exists in the Cloudflare client output (proves the adapter emits it at root scope).

- [ ] **Step 4: Commit**

```bash
git add src/service-worker.ts
git commit -m "feat(pwa): hand-rolled service worker (precache shell, SWR data/tiles, network-only api)"
```

---

## Task 3: Install icons (generator + committed PNGs)

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create (generated): `static/icon-192.png`, `static/icon-512.png`, `static/icon-512-maskable.png`, `static/apple-touch-icon.png`
- Modify: `package.json` (add `sharp` to `devDependencies` if absent; add a `gen:icons` script)

**Interfaces:**
- Consumes: nothing.
- Produces: four PNG files at the paths the manifest (Task 4) references.

- [ ] **Step 1: Ensure `sharp` is a dev dependency**

Run: `npm ls sharp || npm i -D sharp`
Expected: `sharp` present in `devDependencies` (it already resolves in this repo; this makes it explicit for reproducibility).

- [ ] **Step 2: Write the icon generator**

Create `scripts/generate-icons.mjs`:

```js
// Generates the PWA install icons: a flat teal square with a white checkmark
// (the verification action; on-identity, no emoji). Run once; commit the PNGs.
//   node scripts/generate-icons.mjs
import sharp from 'sharp';

const TEAL = '#0fa98e';
const WHITE = '#ffffff';

// Build an SVG string for a `size`×`size` icon.
// rounded: rounded-corner square (for the "any" icons); false = full-bleed
//   (maskable + apple-touch, where the platform applies its own mask/rounding).
// checkScale: checkmark box as a fraction of the canvas.
function iconSvg({ size, rounded, checkScale }) {
	const r = rounded ? size * 0.22 : 0;
	const s = size * checkScale;
	const cx = size / 2;
	const cy = size / 2;
	const x = cx - s / 2;
	const y = cy - s / 2;
	// Checkmark: down-stroke to the elbow, up-stroke to the tip.
	const p1 = [x + s * 0.14, y + s * 0.54];
	const p2 = [x + s * 0.4, y + s * 0.8];
	const p3 = [x + s * 0.86, y + s * 0.22];
	const stroke = size * 0.09;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
	<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${TEAL}"/>
	<path d="M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} L ${p3[0]} ${p3[1]}" fill="none" stroke="${WHITE}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

async function write(out, { renderSize, rounded, checkScale }) {
	const svg = iconSvg({ size: 512, rounded, checkScale });
	await sharp(Buffer.from(svg)).resize(renderSize, renderSize).png().toFile(out);
	console.log('wrote', out);
}

await write('static/icon-192.png', { renderSize: 192, rounded: true, checkScale: 0.55 });
await write('static/icon-512.png', { renderSize: 512, rounded: true, checkScale: 0.55 });
// Maskable: full-bleed teal, check inside Android's 80% safe zone.
await write('static/icon-512-maskable.png', { renderSize: 512, rounded: false, checkScale: 0.45 });
// apple-touch: full-bleed square; iOS applies its own corner radius.
await write('static/apple-touch-icon.png', { renderSize: 180, rounded: false, checkScale: 0.55 });
```

- [ ] **Step 3: Add a convenience script to package.json**

In `package.json` `"scripts"`, add:

```json
"gen:icons": "node scripts/generate-icons.mjs"
```

- [ ] **Step 4: Generate the icons**

Run: `npm run gen:icons`
Expected: four `wrote static/...png` lines.

- [ ] **Step 5: Verify dimensions and that they are valid PNGs**

Run:
```bash
node -e "import('sharp').then(async ({default:s})=>{for(const [f,w] of [['static/icon-192.png',192],['static/icon-512.png',512],['static/icon-512-maskable.png',512],['static/apple-touch-icon.png',180]]){const m=await s(f).metadata();console.log(f,m.width+'x'+m.height,m.format);if(m.width!==w||m.format!=='png')throw new Error('bad '+f);}})"
```
Expected: each file printed as `WxW png` with matching dimensions; no error thrown.

- [ ] **Step 6: Visually sanity-check the icons**

Open the four PNGs (or send them to the user). Confirm: solid teal, crisp centered white check, maskable variant has visible padding around the check (nothing near the edges). If the check looks off-center or clipped, adjust `checkScale`/path in `scripts/generate-icons.mjs` and re-run Steps 4–5.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-icons.mjs package.json package-lock.json static/icon-192.png static/icon-512.png static/icon-512-maskable.png static/apple-touch-icon.png
git commit -m "feat(pwa): flat teal+check install icons (generator + PNGs)"
```

---

## Task 4: Web manifest + `<head>` install metadata

**Files:**
- Create: `static/manifest.webmanifest`
- Modify: `src/app.html` (head)

**Interfaces:**
- Consumes: the four icon PNGs from Task 3.
- Produces: browser-recognized installability (manifest link + Apple meta).

- [ ] **Step 1: Create the manifest**

Create `static/manifest.webmanifest`:

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

- [ ] **Step 2: Wire the head**

In `src/app.html`, add the following inside `<head>`, immediately after the existing `<meta name="theme-color" ... />` line:

```html
		<link rel="manifest" href="/manifest.webmanifest" />
		<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-status-bar-style" content="default" />
		<meta name="apple-mobile-web-app-title" content="Build It?" />
```

- [ ] **Step 3: Validate the manifest JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('static/manifest.webmanifest','utf8')); console.log('manifest ok')"`
Expected: `manifest ok`.

- [ ] **Step 4: Build and confirm manifest + head ship**

Run: `npx vite build && ls .svelte-kit/cloudflare/manifest.webmanifest && grep -c "rel=\"manifest\"" .svelte-kit/cloudflare/index.html 2>/dev/null || echo "check served head in preview"`
Expected: build succeeds; `manifest.webmanifest` present in output. (The head is injected into SSR responses, verified in Task 5's preview.)

- [ ] **Step 5: Commit**

```bash
git add static/manifest.webmanifest src/app.html
git commit -m "feat(pwa): web manifest + apple/mobile install meta"
```

---

## Task 5: Integration verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a verified, installable, offline-capable build.

- [ ] **Step 1: Full suite + type-check**

Run: `npx svelte-check --tsconfig ./tsconfig.json && npx vitest run`
Expected: 0 errors; all tests pass (existing suite + the new `sw-helpers` tests).

- [ ] **Step 2: Preview the production build**

Run: `npx vite build && npx wrangler dev .svelte-kit/cloudflare/_worker.js --port 4173` (background), then `curl -s http://localhost:4173/ | grep -o 'rel="manifest"'`
Expected: build succeeds; the served HTML contains `rel="manifest"` (head shipped). Also `curl -sI http://localhost:4173/service-worker.js | head -1` returns `HTTP/1.1 200`.

- [ ] **Step 3: DevTools install + offline check (Chrome)**

Load `http://localhost:4173/` in Chrome → DevTools → Application:
- Manifest panel: name/icons/theme resolve, no errors; "installable".
- Service Workers panel: worker is `activated and running`.
- Reload once so the SW caches the shell + a navigation. Then check **Offline** in the Service Workers panel and reload: the app boots, pins render (sites.json from `data` cache), and previously-viewed tiles render.
- Network panel while offline: `/api/status` fails at the network (never served from a cache).

- [ ] **Step 4: Tile-cap check**

With DevTools open, pan the map across many areas, then Application → Cache Storage → `tiles`: confirm entry count stays at or below **250** (older tiles evicted).

- [ ] **Step 5: On-device install (manual, both platforms)**

Deploy the branch preview and, on device:
- Android Chrome: install prompt → launches standalone (no URL bar); icon is the teal check.
- iOS Safari: Share → Add to Home Screen → launches standalone; the top controls + safe-area (from #35) look correct without the URL bar; apple-touch icon shows.

- [ ] **Step 6: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "test(pwa): integration verification tweaks" || echo "nothing to commit"
```

---

## Notes for the implementer

- SvelteKit registers `src/service-worker.ts` automatically in the **built** app; `vite dev` registration is unreliable, so always verify via `vite build` + `wrangler dev` (preview), not the dev server.
- The known Cloudflare **SSR self-fetch 1042** gotcha is server-side only — the SW runs in the browser and is unaffected. Do not add server-side fetches.
- Steps that start a background `wrangler dev` should `pkill -f "wrangler dev"` when done.
