import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { submitVerdict } from '$lib/server/submissions';
import { parseSubmission } from '$lib/server/validate';

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) return json({ error: 'platform unavailable' }, { status: 500 });
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, { status: 400 });
	}
	const parsed = parseSubmission(raw);
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
	const { id } = await submitVerdict(platform.env.DB, parsed.value);
	return json({ id }, { status: 201 });
};
