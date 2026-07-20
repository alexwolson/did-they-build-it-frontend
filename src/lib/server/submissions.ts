import type { StatusCounts, Verdict } from '$lib/types';

export interface SubmissionInput {
	conditionKey: string;
	siteId: string;
	deviceId: string;
	verdict: Verdict;
	note?: string | null;
	lat?: number | null;
	lng?: number | null;
	accuracyM?: number | null;
}

export async function submitVerdict(
	db: D1Database,
	input: SubmissionInput
): Promise<{ id: string }> {
	const now = new Date().toISOString();
	const newId = crypto.randomUUID();
	await db
		.prepare('INSERT INTO devices (id, created_at) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING')
		.bind(input.deviceId, now)
		.run();
	const row = await db
		.prepare(
			`INSERT INTO submissions
				(id, condition_key, site_id, device_id, verdict, note, lat, lng, accuracy_m, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
			 ON CONFLICT (device_id, condition_key) DO UPDATE SET
				verdict = excluded.verdict,
				note = COALESCE(excluded.note, submissions.note),
				lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
				created_at = excluded.created_at
			 RETURNING id`
		)
		.bind(
			newId,
			input.conditionKey,
			input.siteId,
			input.deviceId,
			input.verdict,
			input.note ?? null,
			input.lat ?? null,
			input.lng ?? null,
			input.accuracyM ?? null,
			now
		)
		.first<{ id: string }>();
	return { id: row!.id };
}

export async function allStatusCounts(db: D1Database): Promise<Record<string, StatusCounts>> {
	const { results } = await db
		.prepare(
			`SELECT condition_key,
			        SUM(verdict = 'present') AS present,
			        SUM(verdict = 'absent') AS absent,
			        SUM(verdict = 'unclear') AS unclear,
			        SUM(photo_key IS NOT NULL) AS photos
			 FROM submissions GROUP BY condition_key`
		)
		.all<{ condition_key: string; present: number; absent: number; unclear: number; photos: number }>();
	const out: Record<string, StatusCounts> = {};
	for (const r of results) {
		out[r.condition_key] = {
			present: r.present,
			absent: r.absent,
			unclear: r.unclear,
			photos: r.photos
		};
	}
	return out;
}

export async function attachPhoto(
	db: D1Database,
	submissionId: string,
	deviceId: string,
	photoKey: string
): Promise<boolean> {
	const res = await db
		.prepare('UPDATE submissions SET photo_key = ?1 WHERE id = ?2 AND device_id = ?3')
		.bind(photoKey, submissionId, deviceId)
		.run();
	return res.meta.changes === 1;
}
