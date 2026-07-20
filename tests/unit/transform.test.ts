// tests/unit/transform.test.ts
import { describe, expect, it } from 'vitest';
import { conditionKey, formatAddress, siteFromApplication } from '../../etl/transform';
import type { AppRow, ConditionRow } from '../../etl/transform';

const APP: AppRow = {
	id: 15,
	aic_ref: '21 208078 STE 10 OZ',
	ward: '10',
	status: 'OMB Appeal',
	lat: null,
	lng: null,
	address: null,
	source_url: null,
	raw_metadata_json: JSON.stringify({
		STREET_NUM: '147',
		STREET_NAME: 'SPADINA',
		STREET_TYPE: 'AVE',
		STREET_DIRECTION: ' ', // blank direction is a single space in the source data
		DATE_SUBMITTED: '2021-09-03T00:00:00',
		X: 313206.52,
		Y: 4834020.264
	})
};

const COND: ConditionRow = {
	condition_type: 'landscaping',
	raw_text: 'the owner has worked with City Planning… to conserve City trees;',
	description: 'Conserve existing trees and submit a replacement plan if removal is needed.',
	url: 'https://www.toronto.ca/legdocs/mmis/2023/te/bgrd/backgroundfile-239581.pdf',
	instruction: null,
	feature: null,
	source: null
};

describe('conditionKey', () => {
	it('is 16 lowercase hex chars and deterministic', () => {
		const k = conditionKey('21 208078 STE 10 OZ', 'landscaping', 'some raw text');
		expect(k).toMatch(/^[0-9a-f]{16}$/);
		expect(conditionKey('21 208078 STE 10 OZ', 'landscaping', 'some raw text')).toBe(k);
	});
	it('changes when any component changes', () => {
		const k = conditionKey('a', 'b', 'c');
		expect(conditionKey('a', 'b', 'd')).not.toBe(k);
		expect(conditionKey('a', 'x', 'c')).not.toBe(k);
	});
});

describe('formatAddress', () => {
	it('title-cases and trims blank direction', () => {
		expect(formatAddress(JSON.parse(APP.raw_metadata_json))).toBe('147 Spadina Ave');
	});
	it('keeps single-letter direction uppercase', () => {
		expect(
			formatAddress({ STREET_NUM: '580', STREET_NAME: 'FRONT', STREET_TYPE: 'ST', STREET_DIRECTION: 'W' })
		).toBe('580 Front St W');
	});
	it('title-cases the letter after an apostrophe', () => {
		expect(
			formatAddress({ STREET_NUM: '10', STREET_NAME: "O'CONNOR", STREET_TYPE: 'DR', STREET_DIRECTION: ' ' })
		).toBe("10 O'Connor Dr");
	});
	it('title-cases the letter after a hyphen', () => {
		expect(
			formatAddress({ STREET_NUM: '5', STREET_NAME: 'MARY-ANN', STREET_TYPE: 'ST', STREET_DIRECTION: ' ' })
		).toBe('5 Mary-Ann St');
	});
	it('capitalizes the Mc prefix (real downtown Toronto street)', () => {
		expect(
			formatAddress({ STREET_NUM: '2', STREET_NAME: 'MCCAUL', STREET_TYPE: 'ST', STREET_DIRECTION: ' ' })
		).toBe('2 McCaul St');
	});
});

describe('siteFromApplication', () => {
	it('builds a GeoJSON feature with converted coordinates', () => {
		const out = siteFromApplication(APP, [COND], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		const f = out.feature;
		expect(f.properties.siteId).toBe('21-208078-ste-10-oz');
		expect(f.properties.address).toBe('147 Spadina Ave');
		expect(f.properties.appliedYear).toBe(2021);
		expect(f.geometry.coordinates[0]).toBeCloseTo(-79.395565, 3); // lng
		expect(f.geometry.coordinates[1]).toBeCloseTo(43.64808, 3); // lat
		expect(f.properties.conditions).toHaveLength(1);
		expect(f.properties.conditions[0].type).toBe('landscaping');
		expect(f.properties.conditions[0].key).toMatch(/^[0-9a-f]{16}$/);
	});
	it('dedupes identical (type, raw_text) conditions from multiple report versions', () => {
		const out = siteFromApplication(APP, [COND, { ...COND }], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.conditions).toHaveLength(1);
	});
	it('prefers a manual override over metadata X/Y', () => {
		const out = siteFromApplication(APP, [COND], {
			'21 208078 STE 10 OZ': { lat: 43.9, lng: -79.1 }
		});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.geometry.coordinates).toEqual([-79.1, 43.9]);
	});
	it('reports a miss when coordinates are absent and no override exists', () => {
		const noCoords: AppRow = { ...APP, raw_metadata_json: JSON.stringify({ STREET_NUM: '1', STREET_NAME: 'X' }) };
		const out = siteFromApplication(noCoords, [COND], {});
		expect('miss' in out && out.miss).toContain('21 208078 STE 10 OZ');
	});
	it('uses the application lat/lng directly when present (no MTM conversion)', () => {
		const withLatLng: AppRow = { ...APP, lat: 43.6605, lng: -79.3957, raw_metadata_json: '{}' };
		const out = siteFromApplication(withLatLng, [COND], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.geometry.coordinates).toEqual([-79.3957, 43.6605]);
	});
	it('falls back to the addresses-table address and derives year from the AIC ref', () => {
		const uoft: AppRow = {
			...APP,
			aic_ref: '19 129065 STE 11 SA',
			lat: 43.6612,
			lng: -79.3958,
			address: "24 KING'S COLLEGE CIRCLE",
			raw_metadata_json: '{}'
		};
		const out = siteFromApplication(uoft, [COND], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.address).toBe("24 King's College Circle");
		expect(out.feature.properties.appliedYear).toBe(2019); // "19 ..." -> 2019
	});
	it('falls back to raw_text when description is null', () => {
		const out = siteFromApplication(APP, [{ ...COND, description: null }], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.conditions[0].description).toBe(COND.raw_text);
	});
	it('cleans the instruction into a volunteer prompt and carries feature + source', () => {
		const out = siteFromApplication(APP, [
			{
				...COND,
				feature: 'Public plaza',
				source: 'proposed_and_approved',
				instruction: 'Go to 130 St George St. Is there a new public plaza? Yes / No / Can’t tell.'
			}
		], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		const c = out.feature.properties.conditions[0];
		expect(c.feature).toBe('Public plaza');
		expect(c.prompt).toBe('Is there a new public plaza?');
		expect(c.source).toBe('proposed_and_approved');
	});
	it('DOCUMENTED FALLBACK: an unrecognized condition_type coerces to "other"', () => {
		const out = siteFromApplication(APP, [{ ...COND, condition_type: 'cash_contribution' }], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.conditions[0].type).toBe('other');
	});
});
