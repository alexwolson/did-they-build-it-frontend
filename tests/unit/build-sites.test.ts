// tests/unit/build-sites.test.ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readSites } from '../../etl/build-sites';

function fixtureDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec(`
		CREATE TABLE applications (id INTEGER PRIMARY KEY, aic_ref TEXT, ward TEXT,
			status TEXT, raw_metadata_json TEXT);
		CREATE TABLE documents (id INTEGER PRIMARY KEY, application_id INTEGER, url TEXT);
		CREATE TABLE conditions (id INTEGER PRIMARY KEY, application_id INTEGER,
			document_id INTEGER, condition_type TEXT, raw_text TEXT, description TEXT,
			physically_verifiable INTEGER);
	`);
	db.prepare(
		`INSERT INTO applications VALUES (1, '21 208078 STE 10 OZ', '10', 'Closed', ?)`
	).run(
		JSON.stringify({
			STREET_NUM: '147', STREET_NAME: 'SPADINA', STREET_TYPE: 'AVE',
			STREET_DIRECTION: ' ', DATE_SUBMITTED: '2021-09-03T00:00:00',
			X: 313206.52, Y: 4834020.264
		})
	);
	db.prepare(`INSERT INTO documents VALUES (1, 1, 'https://example.com/report.pdf')`).run();
	db.prepare(
		`INSERT INTO conditions VALUES (1, 1, 1, 'landscaping', 'plant trees', 'Plant trees.', 1)`
	).run();
	db.prepare(
		`INSERT INTO conditions VALUES (2, 1, 1, 'cash_contribution', 'pay money', 'Pay.', 0)`
	).run(); // physically_verifiable = 0 → must be excluded
	return db;
}

describe('readSites', () => {
	it('emits one feature per application with verifiable conditions only', () => {
		const { features, misses } = readSites(fixtureDb(), {});
		expect(misses).toEqual([]);
		expect(features).toHaveLength(1);
		expect(features[0].properties.conditions).toHaveLength(1);
		expect(features[0].properties.conditions[0].type).toBe('landscaping');
	});
});
