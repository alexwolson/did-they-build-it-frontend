import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { attachPhoto } from '$lib/server/submissions';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

export const POST: RequestHandler = async ({ request, url, platform }) => {
	if (!platform) return json({ error: 'platform unavailable' }, { status: 500 });
	const submissionId = url.searchParams.get('submission') ?? '';
	const deviceId = url.searchParams.get('device') ?? '';
	if (!submissionId || !deviceId) return json({ error: 'missing submission/device' }, { status: 400 });

	const contentType = request.headers.get('content-type') ?? '';
	const ext = TYPES[contentType];
	if (!ext) return json({ error: 'unsupported content-type' }, { status: 400 });

	const body = await request.arrayBuffer();
	if (body.byteLength === 0 || body.byteLength > MAX_BYTES)
		return json({ error: 'photo must be 1 byte – 5 MiB' }, { status: 413 });

	const photoKey = `photos/${submissionId}.${ext}`;
	// Verify ownership BEFORE writing to R2 so strangers can't attach photos.
	const owned = await attachPhoto(platform.env.DB, submissionId, deviceId, photoKey);
	if (!owned) return json({ error: 'unknown submission for this device' }, { status: 403 });
	await platform.env.BUCKET.put(photoKey, body, { httpMetadata: { contentType } });
	return json({ ok: true });
};
