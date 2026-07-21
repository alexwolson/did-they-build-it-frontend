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

function classify(over: { url: string } & Partial<Omit<Parameters<typeof classifyRequest>[0], 'url'>>): RequestClass {
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
