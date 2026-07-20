import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { allStatusCounts, attachPhoto, submitVerdict } from '../../src/lib/server/submissions';

const base = {
	siteId: '21-208078-ste-10-oz',
	conditionKey: 'abcd1234abcd1234',
	deviceId: 'device-1'
};

describe('submissions (real local D1)', () => {
	it('records a one-tap verdict and returns a submission id', async () => {
		const { id } = await submitVerdict(env.DB, { ...base, verdict: 'present' });
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234']).toEqual({ present: 1, absent: 0, unclear: 0, photos: 0 });
	});

	it('re-submitting from the same device updates, not duplicates, and keeps the id', async () => {
		const first = await submitVerdict(env.DB, { ...base, verdict: 'present' });
		const second = await submitVerdict(env.DB, { ...base, verdict: 'absent' });
		expect(second.id).toBe(first.id);
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234']).toEqual({ present: 0, absent: 1, unclear: 0, photos: 0 });
	});

	it('different devices count separately; notes and location are stored', async () => {
		await submitVerdict(env.DB, {
			...base,
			deviceId: 'device-2',
			verdict: 'present',
			note: 'Racks are by the back door',
			lat: 43.648,
			lng: -79.395,
			accuracyM: 12
		});
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234'].present).toBe(1);
		expect(counts['abcd1234abcd1234'].absent).toBe(1);
	});

	it('attachPhoto sets the key only for the owning device', async () => {
		const { id } = await submitVerdict(env.DB, { ...base, verdict: 'absent' });
		expect(await attachPhoto(env.DB, id, 'WRONG-device', 'photos/x.jpg')).toBe(false);
		expect(await attachPhoto(env.DB, id, 'device-1', 'photos/x.jpg')).toBe(true);
		const counts = await allStatusCounts(env.DB);
		expect(counts['abcd1234abcd1234'].photos).toBe(1);
	});
});
