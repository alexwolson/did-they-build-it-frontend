// tests/unit/build-sites.test.ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readSites } from '../../etl/build-sites';

function fixtureDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec(`
		CREATE TABLE applications (id INTEGER PRIMARY KEY, aic_ref TEXT, ward TEXT,
			status TEXT, raw_metadata_json TEXT, lat REAL, lng REAL, source_url TEXT);
		CREATE TABLE addresses (application_id INTEGER, address TEXT);
		CREATE TABLE documents (id INTEGER PRIMARY KEY, application_id INTEGER, url TEXT, report_stage TEXT);
		CREATE TABLE conditions (id INTEGER PRIMARY KEY, application_id INTEGER,
			document_id INTEGER, condition_type TEXT, title TEXT, physicality TEXT,
			street_visibility TEXT, physically_verifiable INTEGER,
			review_status TEXT, fulfillment_status TEXT);
		CREATE VIEW verifiable_conditions AS
			SELECT c.id AS condition_id, c.application_id, c.condition_type,
			       c.title, c.physicality, c.street_visibility,
			       c.review_status, c.fulfillment_status,
			       d.url AS source_url, d.report_stage,
			       CASE
			           WHEN d.report_stage = 'settlement' THEN 'olt_settlement'
			           ELSE 'staff_report_condition'
			       END AS source
			FROM conditions c
			LEFT JOIN documents d ON d.id = c.document_id
			WHERE c.physically_verifiable = 1;
	`);
	db.prepare(
		`INSERT INTO applications VALUES (1, '21 208078 STE 10 OZ', '10', 'Closed', ?, NULL, NULL, NULL)`
	).run(
		JSON.stringify({
			STREET_NUM: '147', STREET_NAME: 'SPADINA', STREET_TYPE: 'AVE',
			STREET_DIRECTION: ' ', DATE_SUBMITTED: '2021-09-03T00:00:00',
			X: 313206.52, Y: 4834020.264
		})
	);
	db.prepare(`INSERT INTO addresses VALUES (1, '147 SPADINA AVE')`).run();
	db.prepare(`INSERT INTO documents VALUES (1, 1, 'https://example.com/report.pdf', NULL)`).run();
	// physically_verifiable = 1 → included. Maps: title→feature, physicality→description/rawText,
	// street_visibility→prompt (via cleanPrompt, which strips the "Go to…" lead-in and answer options).
	db.prepare(
		`INSERT INTO conditions VALUES (1, 1, 1, 'landscaping', 'Street trees',
			'Plant new street trees along the Spadina Avenue frontage.',
			'Go to 147 Spadina Ave. Are there new street trees? Yes / No / Can''t tell.',
			1, 'unreviewed', 'unknown')`
	).run();
	// physically_verifiable = 0 → must be excluded (the verifiable_conditions view filters it out).
	db.prepare(
		`INSERT INTO conditions VALUES (2, 1, 1, 'community_facility', 'Childcare facility',
			'Provide a licensed childcare facility within the development.', 'n/a',
			0, 'unreviewed', 'unknown')`
	).run();
	return db;
}

describe('readSites', () => {
	it('emits one feature per application, filtered to physically-verifiable conditions only', () => {
		const { features, misses } = readSites(fixtureDb(), {});
		expect(misses).toEqual([]);
		expect(features).toHaveLength(1);
		expect(features[0].properties.conditions).toHaveLength(1);
		const c = features[0].properties.conditions[0];
		expect(c.type).toBe('landscaping');
		expect(c.feature).toBe('Street trees'); // from conditions.title
		expect(c.prompt).toBe('Are there new street trees?'); // cleanPrompt(street_visibility)
		expect(c.description).toBe('Plant new street trees along the Spadina Avenue frontage.'); // physicality
		expect(c.source).toBe('staff_report_condition');
	});
});
