import { describe, expect, it } from 'vitest';
import { siteRing, RING_COLORS, dominantType } from '../../src/lib/status';
import type { SiteProperties } from '../../src/lib/types';

const site = (types: string[]): SiteProperties => ({
	siteId: 's',
	address: 'a',
	aicRef: 'r',
	ward: '10',
	status: null,
	appliedYear: null,
	conditions: types.map((t, i) => ({
		key: `k${i}`,
		type: t as SiteProperties['conditions'][0]['type'],
		feature: null,
		prompt: null,
		description: '',
		rawText: '',
		sourceUrl: '',
		source: null
	}))
});

const counts = (m: Record<string, [number, number, number]>) =>
	Object.fromEntries(
		Object.entries(m).map(([k, [present, absent, unclear]]) => [
			k,
			{ present, absent, unclear, photos: 0 }
		])
	);

describe('siteRing', () => {
	it('is none with no reports', () => {
		expect(siteRing(site(['pavers']), {})).toBe('none');
	});
	it('is present when present outweighs absent across conditions', () => {
		expect(siteRing(site(['pavers', 'landscaping']), counts({ k0: [2, 0, 0], k1: [1, 1, 0] }))).toBe('present');
	});
	it('is absent when absent outweighs present', () => {
		expect(siteRing(site(['pavers']), counts({ k0: [0, 3, 1] }))).toBe('absent');
	});
	it('is mixed on a tie or unclear-only reports', () => {
		expect(siteRing(site(['pavers']), counts({ k0: [1, 1, 0] }))).toBe('mixed');
		expect(siteRing(site(['pavers']), counts({ k0: [0, 0, 2] }))).toBe('mixed');
	});
	it('RING_COLORS covers every ring state', () => {
		for (const s of ['none', 'present', 'absent', 'mixed'] as const)
			expect(RING_COLORS[s]).toMatch(/^#/);
	});
});

describe('dominantType', () => {
	it('picks the most frequent condition type', () => {
		expect(dominantType(site(['bike_parking', 'bike_parking', 'public_art']))).toBe('bike_parking');
	});
});
