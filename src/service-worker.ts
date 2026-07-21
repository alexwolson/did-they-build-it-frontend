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
const NAV_TIMEOUT_MS = 3000; // fall back to the cached shell if navigation stalls this long

// Precache the hashed app shell. Exclude /data/sites.json — it is served by the
// stale-while-revalidate `data` strategy, not treated as an immutable asset.
const PRECACHE = [...build, ...files].filter((path) => path !== '/data/sites.json');
const PRECACHE_SET = new Set([...build, ...files]);

sw.addEventListener('install', (event) => {
	// Precache the hashed shell assets, plus a best-effort copy of the root document
	// so the SPA boots on the FIRST offline load. This app is SSR — there is no static
	// index.html in `files`, and the network-first navigate handler only caches "/" once
	// the SW is already controlling (from the 2nd load on). cache.add('/') is non-atomic
	// (its own catch) so a transient failure can't fail the whole install. SHELL is
	// version-scoped and navigations stay network-first, so this copy never goes stale.
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL);
			await cache.addAll(PRECACHE);
			await cache.add('/').catch(() => {});
		})()
	);
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

	event.respondWith(handle(event, cls, request));
});

async function handle(event: FetchEvent, cls: RequestClass, request: Request): Promise<Response> {
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
		// Offline shell: this exact URL if cached, else "/" (any deep-linked route still
		// boots the SPA, which then client-routes).
		const cached = (await cache.match(request)) ?? (await cache.match('/'));
		const network = fetch(request).then(async (res) => {
			if (res.ok) await cache.put(request, res.clone());
			return res;
		});

		// Nothing cached yet (first-ever visit): we must wait for the network.
		if (!cached) {
			try {
				return await network;
			} catch {
				return Response.error();
			}
		}

		// Network-first, but don't hang on a stalled venue connection: race the network
		// against a timeout and serve the cached shell if it doesn't answer in time.
		let timer: ReturnType<typeof setTimeout>;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('nav-timeout')), NAV_TIMEOUT_MS);
		});
		try {
			return await Promise.race([network, timeout]);
		} catch {
			// Network failed or stalled past the timeout — serve the shell now, but keep
			// the in-flight request alive so its cache.put still lands for next time.
			event.waitUntil(network.catch(() => {}));
			return cached;
		} finally {
			clearTimeout(timer!);
		}
	}

	if (cls === 'data') return staleWhileRevalidate(event, request, DATA);
	if (cls === 'tiles') return staleWhileRevalidate(event, request, TILES, TILE_CAP);

	return fetch(request);
}

async function staleWhileRevalidate(
	event: FetchEvent,
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
	if (cached) {
		// Keep the worker alive so the background refresh + trim actually complete.
		event.waitUntil(network);
		return cached;
	}
	return (await network) ?? Response.error();
}
