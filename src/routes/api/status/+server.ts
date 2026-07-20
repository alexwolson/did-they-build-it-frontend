import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { allStatusCounts } from '$lib/server/submissions';

export const GET: RequestHandler = async ({ platform }) => {
	if (!platform) return json({ error: 'platform unavailable' }, { status: 500 });
	const conditions = await allStatusCounts(platform.env.DB);
	return json({ conditions }, { headers: { 'cache-control': 'no-store' } });
};
