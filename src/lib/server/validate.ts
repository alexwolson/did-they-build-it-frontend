import type { SubmissionPayload, Verdict } from '$lib/types';
import { VERDICTS } from '$lib/types';
import sites from '../../../static/data/sites.json';

const validTargets = new Set<string>();
for (const f of sites.features) {
	for (const c of f.properties.conditions) {
		validTargets.add(`${f.properties.siteId}:${c.key}`);
	}
}

const isFiniteIn = (v: unknown, lo: number, hi: number) =>
	typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function parseSubmission(
	raw: unknown
): { ok: true; value: SubmissionPayload } | { ok: false; error: string } {
	if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' };
	const o = raw as Record<string, unknown>;

	if (typeof o.deviceId !== 'string' || o.deviceId.length < 8 || o.deviceId.length > 64)
		return { ok: false, error: 'bad deviceId' };
	if (!VERDICTS.includes(o.verdict as Verdict)) return { ok: false, error: 'bad verdict' };
	if (typeof o.siteId !== 'string' || typeof o.conditionKey !== 'string')
		return { ok: false, error: 'bad target' };
	if (!validTargets.has(`${o.siteId}:${o.conditionKey}`))
		return { ok: false, error: 'unknown site/condition' };
	if (o.note != null && (typeof o.note !== 'string' || o.note.length > 500))
		return { ok: false, error: 'bad note' };
	const hasLat = o.lat != null;
	const hasLng = o.lng != null;
	if (hasLat !== hasLng) return { ok: false, error: 'lat/lng must come together' };
	if (hasLat && (!isFiniteIn(o.lat, -90, 90) || !isFiniteIn(o.lng, -180, 180)))
		return { ok: false, error: 'bad coordinates' };
	if (o.accuracyM != null && !isFiniteIn(o.accuracyM, 0, 100000))
		return { ok: false, error: 'bad accuracy' };

	return {
		ok: true,
		value: {
			deviceId: o.deviceId,
			siteId: o.siteId,
			conditionKey: o.conditionKey,
			verdict: o.verdict as Verdict,
			note: (o.note as string | undefined) ?? null,
			lat: (o.lat as number | undefined) ?? null,
			lng: (o.lng as number | undefined) ?? null,
			accuracyM: (o.accuracyM as number | undefined) ?? null
		}
	};
}
