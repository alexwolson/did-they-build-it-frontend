// NOTE: etl/ files use explicit .ts extensions and relative paths (no $lib) so
// they run under plain `node` (native type stripping needs full specifiers).
import { createHash } from 'node:crypto';
import type { ConditionSource, ConditionType, SiteCondition, SiteFeature } from '../src/lib/types.ts';
import { CONDITION_TYPES } from '../src/lib/types.ts';
import { mtm10ToWgs84 } from './mtm.ts';

export interface AppRow {
	id: number;
	aic_ref: string;
	ward: string | null;
	status: string | null;
	raw_metadata_json: string;
	lat: number | null; // WGS84 (newer DBs store coords directly on the application)
	lng: number | null;
	address: string | null; // from the addresses table, when raw_metadata_json has no street parts
	source_url: string | null; // application-level source, used as the condition url fallback
}

export interface ConditionRow {
	condition_type: string;
	raw_text: string;
	description: string | null;
	url: string;
	instruction: string | null; // "Go to X. Is there Y? Yes / No / Can't tell."
	feature: string | null; // short label, e.g. "Public plaza"
	source: string | null; // commitment strength
}

export type Overrides = Record<string, { lat: number; lng: number }>;

const SOURCES: readonly string[] = [
	'staff_report_condition',
	'section_37',
	'olt_settlement',
	'proposed_and_approved'
];

export function conditionKey(aicRef: string, type: string, rawText: string): string {
	return createHash('sha256').update(`${aicRef}|${type}|${rawText}`).digest('hex').slice(0, 16);
}

function titleCase(s: string): string {
	return (
		s
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean)
			.map((w) => (w.length === 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
			.join(' ')
			// Irish/patronymic prefix only: capitalize the letter after an apostrophe
			// when the apostrophe follows a single word-initial letter (O'Connor,
			// D'Arcy) — NOT a possessive ("King's" must stay lowercase-s).
			.replace(/\b([A-Za-z])'([a-z])/g, (_m, a: string, b: string) => `${a}'${b.toUpperCase()}`)
			// Hyphenated names: Mary-Ann.
			.replace(/-([a-z])/g, (_m, c: string) => `-${c.toUpperCase()}`)
			// "Mc"/"Mac" surname prefix (no delimiter, so the rules above can't reach it).
			.replace(/\b(Mc|Mac)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
	);
}

export function formatAddress(md: Record<string, unknown>): string {
	const parts = [
		String(md.STREET_NUM ?? '').trim(),
		titleCase(String(md.STREET_NAME ?? '').trim()),
		titleCase(String(md.STREET_TYPE ?? '').trim()),
		String(md.STREET_DIRECTION ?? '').trim().toUpperCase()
	];
	return parts.filter(Boolean).join(' ');
}

// Turn a task instruction into a clean volunteer-facing question:
// "Go to 24 King's College Circle. Is there a pavilion? Yes / No / Can't tell."
//   -> "Is there a pavilion?"
export function cleanPrompt(instruction: string | null): string | null {
	if (!instruction) return null;
	const s = instruction
		.trim()
		.replace(/^go to[^.?!]*[.?!]\s*/i, '') // drop the "Go to <address>." lead-in
		// drop the trailing answer options (apostrophe may be straight ' or curly ’)
		.replace(/\s*yes\s*\/\s*no\s*\/\s*can[’']?t\s*tell\.?\s*$/i, '')
		.trim();
	return s || null;
}

export function siteFromApplication(
	app: AppRow,
	conditionRows: ConditionRow[],
	overrides: Overrides
): { feature: SiteFeature } | { miss: string } {
	const md = JSON.parse(app.raw_metadata_json ?? '{}') as Record<string, unknown>;

	const override = overrides[app.aic_ref];
	let lat: number, lng: number;
	if (override) {
		({ lat, lng } = override);
	} else if (Number.isFinite(app.lat) && Number.isFinite(app.lng) && app.lat !== 0 && app.lng !== 0) {
		lat = app.lat as number;
		lng = app.lng as number;
	} else {
		const x = Number(md.X);
		const y = Number(md.Y);
		if (Number.isFinite(x) && x > 0 && Number.isFinite(y) && y > 0) {
			({ lat, lng } = mtm10ToWgs84(x, y));
		} else {
			return { miss: `${app.aic_ref}: no coordinates and no override` };
		}
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
				: 'other',
			feature: row.feature?.trim() || null,
			prompt: cleanPrompt(row.instruction),
			description: row.description ?? row.raw_text,
			rawText: row.raw_text,
			sourceUrl: row.url,
			source: SOURCES.includes(row.source ?? '') ? (row.source as ConditionSource) : null
		});
	}

	const address = formatAddress(md) || (app.address ? titleCase(app.address) : app.aic_ref);

	// Applied year: DATE_SUBMITTED metadata, else the 2-digit year prefix of the
	// AIC reference ("19 129065 STE 11 SA" -> 2019).
	const submitted = String(md.DATE_SUBMITTED ?? '');
	let appliedYear = /^\d{4}/.test(submitted) ? Number(submitted.slice(0, 4)) : null;
	if (appliedYear === null) {
		const m = /^(\d{2})\s/.exec(app.aic_ref);
		if (m) appliedYear = 2000 + Number(m[1]);
	}

	return {
		feature: {
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [lng, lat] },
			properties: {
				siteId: app.aic_ref.toLowerCase().replace(/\s+/g, '-'),
				address,
				aicRef: app.aic_ref,
				ward: app.ward ?? '',
				status: app.status,
				appliedYear,
				conditions
			}
		}
	};
}
