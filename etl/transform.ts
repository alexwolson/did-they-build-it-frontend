// NOTE: etl/ files use explicit .ts extensions and relative paths (no $lib) so
// they run under plain `node` (native type stripping needs full specifiers).
import { createHash } from 'node:crypto';
import type { ConditionType, SiteCondition, SiteFeature } from '../src/lib/types.ts';
import { CONDITION_TYPES } from '../src/lib/types.ts';
import { mtm10ToWgs84 } from './mtm.ts';

export interface AppRow {
	id: number;
	aic_ref: string;
	ward: string | null;
	status: string | null;
	raw_metadata_json: string;
}

export interface ConditionRow {
	condition_type: string;
	raw_text: string;
	description: string | null;
	url: string;
}

export type Overrides = Record<string, { lat: number; lng: number }>;

export function conditionKey(aicRef: string, type: string, rawText: string): string {
	return createHash('sha256').update(`${aicRef}|${type}|${rawText}`).digest('hex').slice(0, 16);
}

export function formatAddress(md: Record<string, unknown>): string {
	const title = (s: string) =>
		s
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean)
			.map((w) => (w.length === 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
			.join(' ')
			// Capitalize the letter after an internal apostrophe or hyphen too
			// (e.g. "O'connor" -> "O'Connor", "Mary-ann" -> "Mary-Ann").
			.replace(/['-][a-z]/g, (m) => m[0] + m[1].toUpperCase())
			// "Mc"/"Mac" surname prefix: the general apostrophe/hyphen/space rule
			// above can't know "McCaul" needs a second internal capital, since
			// there's no delimiter between "Mc" and "Caul". This is a naming
			// convention, not a lookup of specific street names, but it can
			// false-positive on words that merely start with "Mac" (e.g. "Mack").
			.replace(/\b(Mc|Mac)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
	const parts = [
		String(md.STREET_NUM ?? '').trim(),
		title(String(md.STREET_NAME ?? '').trim()),
		title(String(md.STREET_TYPE ?? '').trim()),
		String(md.STREET_DIRECTION ?? '').trim().toUpperCase()
	];
	return parts.filter(Boolean).join(' ');
}

export function siteFromApplication(
	app: AppRow,
	conditionRows: ConditionRow[],
	overrides: Overrides
): { feature: SiteFeature } | { miss: string } {
	const md = JSON.parse(app.raw_metadata_json ?? '{}') as Record<string, unknown>;

	const override = overrides[app.aic_ref];
	const x = Number(md.X);
	const y = Number(md.Y);
	let lat: number, lng: number;
	if (override) {
		({ lat, lng } = override);
	} else if (Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0) {
		({ lat, lng } = mtm10ToWgs84(x, y));
	} else {
		return { miss: `${app.aic_ref}: no X/Y in metadata and no override` };
	}

	const seen = new Set<string>();
	const conditions: SiteCondition[] = [];
	for (const row of conditionRows) {
		const key = conditionKey(app.aic_ref, row.condition_type, row.raw_text);
		if (seen.has(key)) continue; // same condition in multiple report versions
		seen.add(key);
		conditions.push({
			key,
			type: (CONDITION_TYPES as readonly string[]).includes(row.condition_type)
				? (row.condition_type as ConditionType)
				: 'landscaping',
			description: row.description ?? row.raw_text,
			rawText: row.raw_text,
			sourceUrl: row.url
		});
	}

	const submitted = String(md.DATE_SUBMITTED ?? '');
	const appliedYear = /^\d{4}/.test(submitted) ? Number(submitted.slice(0, 4)) : null;

	return {
		feature: {
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [lng, lat] },
			properties: {
				siteId: app.aic_ref.toLowerCase().replace(/\s+/g, '-'),
				address: formatAddress(md),
				aicRef: app.aic_ref,
				ward: app.ward ?? '',
				status: app.status,
				appliedYear,
				conditions
			}
		}
	};
}
