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

// Evict a cache down to `max` entries, oldest-first: cache.keys() returns Requests
// in insertion order, so the front is the oldest. This is approximate LRU — a
// re-cached (re-put) entry moves to the back. Only trims when over the cap. Note the
// tiles bucket also holds the map style/sprite/glyphs, which are inserted first and
// so are evicted first under heavy panning; they are re-cached on the next online load.
export async function trimToCap(cache: Pick<Cache, 'keys' | 'delete'>, max: number): Promise<void> {
	const keys = await cache.keys();
	if (keys.length <= max) return;
	const excess = keys.length - max;
	for (let i = 0; i < excess; i++) {
		await cache.delete(keys[i]);
	}
}
