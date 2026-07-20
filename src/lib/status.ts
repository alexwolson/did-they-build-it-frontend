import type { SiteProperties, StatusCounts } from '$lib/types';

export type RingState = 'none' | 'present' | 'absent' | 'mixed';

// Civic Fresh status colours (match app.css tokens --none/--present/--absent/--unclear).
export const RING_COLORS: Record<RingState, string> = {
	none: '#9aa8a2',
	present: '#16a34a',
	absent: '#e5484d',
	mixed: '#f5a623'
};

export function siteRing(
	site: SiteProperties,
	counts: Record<string, StatusCounts>
): RingState {
	let present = 0;
	let absent = 0;
	let any = 0;
	for (const c of site.conditions) {
		const s = counts[c.key];
		if (!s) continue;
		present += s.present;
		absent += s.absent;
		any += s.present + s.absent + s.unclear;
	}
	if (any === 0) return 'none';
	if (present > absent) return 'present';
	if (absent > present) return 'absent';
	return 'mixed';
}

export function dominantType(site: SiteProperties): SiteProperties['conditions'][0]['type'] {
	const tally = new Map<string, number>();
	for (const c of site.conditions) tally.set(c.type, (tally.get(c.type) ?? 0) + 1);
	let best = site.conditions[0].type;
	let n = 0;
	for (const [t, count] of tally) if (count > n) ((best = t as typeof best), (n = count));
	return best;
}
