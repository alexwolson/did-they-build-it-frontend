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
