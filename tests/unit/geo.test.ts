import { describe, expect, it } from 'vitest';
import { circlePolygon, formatDistance, haversineM, sortByDistance } from '../../src/lib/geo';
import type { SiteFeature } from '../../src/lib/types';

const at = (lng: number, lat: number, siteId: string): SiteFeature => ({
	type: 'Feature',
	geometry: { type: 'Point', coordinates: [lng, lat] },
	properties: { siteId, address: '', aicRef: '', ward: '', status: null, appliedYear: null, conditions: [] }
});

describe('haversineM', () => {
	it('CN Tower to Union Station is ~500-700 m', () => {
		const d = haversineM({ lat: 43.6426, lng: -79.3871 }, { lat: 43.6453, lng: -79.3806 });
		expect(d).toBeGreaterThan(400);
		expect(d).toBeLessThan(800);
	});
	it('zero distance to itself', () => {
		expect(haversineM({ lat: 43.6, lng: -79.4 }, { lat: 43.6, lng: -79.4 })).toBe(0);
	});
});

describe('formatDistance', () => {
	it('metres under 1 km, one-decimal km above', () => {
		expect(formatDistance(87)).toBe('87 m');
		expect(formatDistance(1400)).toBe('1.4 km');
	});
});

describe('circlePolygon', () => {
	it('closes the ring and every vertex sits ~radius metres from the centre', () => {
		const lng = -79.3957;
		const lat = 43.6605;
		const poly = circlePolygon(lng, lat, 55, 32);
		const ring = poly.geometry.coordinates[0];
		expect(ring).toHaveLength(33); // steps + 1 (closed)
		expect(ring[0]).toEqual(ring[ring.length - 1]); // first === last
		for (const [plng, plat] of ring) {
			const d = haversineM({ lat, lng }, { lat: plat, lng: plng });
			expect(d).toBeGreaterThan(50);
			expect(d).toBeLessThan(60);
		}
	});
});

describe('sortByDistance', () => {
	it('sorts nearest first with distances attached', () => {
		const sites = [at(-79.38, 43.66, 'far'), at(-79.3905, 43.6455, 'near')];
		const sorted = sortByDistance(sites, { lat: 43.645, lng: -79.39 });
		expect(sorted[0].site.properties.siteId).toBe('near');
		expect(sorted[0].distanceM).toBeLessThan(sorted[1].distanceM);
	});
});
