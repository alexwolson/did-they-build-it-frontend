// tests/unit/transform.test.ts
import { describe, expect, it } from 'vitest';
import { conditionKey, formatAddress, siteFromApplication } from '../../etl/transform';
import type { AppRow, ConditionRow } from '../../etl/transform';

const APP: AppRow = {
	id: 15,
	aic_ref: '21 208078 STE 10 OZ',
	ward: '10',
	status: 'OMB Appeal',
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
	url: 'https://www.toronto.ca/legdocs/mmis/2023/te/bgrd/backgroundfile-239581.pdf'
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
	it('reports a miss when X/Y are absent and no override exists', () => {
		const noXY: AppRow = { ...APP, raw_metadata_json: JSON.stringify({ STREET_NUM: '1', STREET_NAME: 'X' }) };
		const out = siteFromApplication(noXY, [COND], {});
		expect('miss' in out && out.miss).toContain('21 208078 STE 10 OZ');
	});
	it('falls back to raw_text when description is null', () => {
		const out = siteFromApplication(APP, [{ ...COND, description: null }], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.conditions[0].description).toBe(COND.raw_text);
	});
	it('DOCUMENTED FALLBACK (not desirable): an unrecognized condition_type silently coerces to landscaping', () => {
		// Locks in current behavior so any future change is deliberate. A later task
		// is expected to surface a warning at the CLI layer when this fallback fires.
		const out = siteFromApplication(APP, [{ ...COND, condition_type: 'cash_contribution' }], {});
		if (!('feature' in out)) throw new Error('expected a feature');
		expect(out.feature.properties.conditions[0].type).toBe('landscaping');
	});
});
