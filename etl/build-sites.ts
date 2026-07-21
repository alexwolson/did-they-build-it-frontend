// NOTE: etl/ files use explicit .ts extensions and relative paths (no $lib) so
// they run under plain `node` (native type stripping needs full specifiers).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { SiteFeature, SitesCollection } from '../src/lib/types.ts';
import { CONDITION_TYPES } from '../src/lib/types.ts';
import { siteFromApplication, type AppRow, type ConditionRow, type Overrides } from './transform.ts';

// Narrow structural type so tests can pass an in-memory DatabaseSync.
export type DatabaseSyncLike = Pick<DatabaseSync, 'prepare'>;

const KNOWN_CONDITION_TYPES = new Set<string>(CONDITION_TYPES);

export function readSites(
	db: DatabaseSyncLike,
	overrides: Overrides
): { features: SiteFeature[]; misses: string[] } {
	const apps = db
		.prepare(
			`SELECT a.id, a.aic_ref, a.ward, a.status, a.raw_metadata_json, a.lat, a.lng, a.source_url,
			        (SELECT ad.address FROM addresses ad WHERE ad.application_id = a.id LIMIT 1) AS address
			 FROM applications a
			 WHERE EXISTS (SELECT 1 FROM verifiable_conditions vc
			               JOIN verification_tasks t ON t.condition_id = vc.condition_id
			               WHERE vc.application_id = a.id
			                 AND t.is_real_commitment = 1 AND t.is_publicly_checkable = 1)
			 ORDER BY a.aic_ref`
		)
		.all() as unknown as AppRow[];

	const condStmt = db.prepare(
		`SELECT vc.condition_type, vc.raw_text, vc.description, t.instruction, t.feature, vc.source,
		        vc.source_url AS doc_url
		 FROM verifiable_conditions vc
		 JOIN verification_tasks t ON t.condition_id = vc.condition_id
		 WHERE vc.application_id = ? AND t.is_real_commitment = 1 AND t.is_publicly_checkable = 1
		 ORDER BY vc.condition_id`
	);

	const features: SiteFeature[] = [];
	const misses: string[] = [];
	for (const app of apps) {
		const raw = condStmt.all(app.id) as unknown as (ConditionRow & { doc_url: string | null })[];
		const conditions: ConditionRow[] = raw.map((r) => ({
			condition_type: r.condition_type,
			raw_text: r.raw_text,
			description: r.description,
			url: r.doc_url ?? app.source_url ?? '',
			instruction: r.instruction,
			feature: r.feature,
			source: r.source
		}));

		// siteFromApplication silently coerces an unrecognized condition_type to
		// 'other'. Detect that here against the raw rows *before* coercion, so a
		// bad upstream value never passes through unnoticed.
		for (const row of conditions) {
			if (!KNOWN_CONDITION_TYPES.has(row.condition_type)) {
				console.error(
					`WARNING — ${app.aic_ref}: unrecognized condition_type ` +
						`"${row.condition_type}" coerced to "other"`
				);
			}
		}

		const out = siteFromApplication(app, conditions, overrides);
		if ('feature' in out) features.push(out.feature);
		else misses.push(out.miss);
	}
	return { features, misses };
}

// ---- CLI: node etl/build-sites.ts <path-to-aic.db> ----
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	const dbPath = process.argv[2];
	if (!dbPath) {
		console.error('usage: node etl/build-sites.ts <path-to-aic.db>');
		process.exit(2);
	}
	const here = dirname(fileURLToPath(import.meta.url));
	const overrides = JSON.parse(
		readFileSync(join(here, 'overrides.json'), 'utf8')
	) as Overrides;

	const db = new DatabaseSync(dbPath, { readOnly: true });
	const { features, misses } = readSites(db, overrides);

	const collection: SitesCollection = {
		type: 'FeatureCollection',
		generated: new Date().toISOString(),
		features
	};
	const outPath = join(here, '..', 'static', 'data', 'sites.json');
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, JSON.stringify(collection));

	const nConditions = features.reduce((n, f) => n + f.properties.conditions.length, 0);
	console.log(`sites.json: ${features.length} sites, ${nConditions} conditions -> ${outPath}`);
	if (misses.length > 0) {
		console.error(`\nWARNING — ${misses.length} application(s) skipped (no coordinates):`);
		for (const m of misses) console.error(`  - ${m}`);
		console.error('Add entries to etl/overrides.json to place them manually.');
	}
}
