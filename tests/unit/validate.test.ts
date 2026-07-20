import { describe, expect, it } from 'vitest';
import { parseSubmission } from '../../src/lib/server/validate';
import sites from '../../static/data/sites.json';

// Use a real site/condition from the committed sites.json so validation passes.
const site = sites.features[0].properties;
const good = {
	deviceId: crypto.randomUUID(),
	siteId: site.siteId,
	conditionKey: site.conditions[0].key,
	verdict: 'present'
};

describe('parseSubmission', () => {
	it('accepts a minimal valid payload', () => {
		const r = parseSubmission(good);
		expect(r.ok).toBe(true);
	});
	it('accepts optional note and location', () => {
		const r = parseSubmission({ ...good, note: 'by the door', lat: 43.6, lng: -79.4, accuracyM: 10 });
		expect(r.ok).toBe(true);
	});
	it('rejects unknown verdicts', () => {
		expect(parseSubmission({ ...good, verdict: 'maybe' }).ok).toBe(false);
	});
	it('rejects a condition key that is not in sites.json', () => {
		expect(parseSubmission({ ...good, conditionKey: 'ffffffffffffffff' }).ok).toBe(false);
	});
	it('rejects a mismatched site/condition pair', () => {
		const other = sites.features[1].properties;
		expect(parseSubmission({ ...good, siteId: other.siteId }).ok).toBe(false);
	});
	it('rejects notes over 500 chars and junk coordinates', () => {
		expect(parseSubmission({ ...good, note: 'x'.repeat(501) }).ok).toBe(false);
		expect(parseSubmission({ ...good, lat: 999 }).ok).toBe(false);
	});
	it('rejects non-object input', () => {
		expect(parseSubmission('nope').ok).toBe(false);
	});
});
