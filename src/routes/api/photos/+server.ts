import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { attachPhoto, submissionOwnedByDevice } from '$lib/server/submissions';

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

	// Fast-fail on an oversized body BEFORE buffering it into worker memory.
	// Content-Length can be absent or spoofed, so this is a belt-and-suspenders
	// optimization only — the authoritative check is the byteLength check below,
	// after the body is actually read.
	const contentLength = request.headers.get('content-length');
	if (contentLength !== null && Number(contentLength) > MAX_BYTES) {
		return json({ error: 'photo must be 1 byte – 5 MiB' }, { status: 413 });
	}

	const photoKey = `photos/${submissionId}.${ext}`;

	// Verify ownership BEFORE writing to R2 so strangers can't write objects to
	// our bucket. This check is read-only (does not touch photo_key): the DB is
	// only committed via attachPhoto below, after the R2 write has succeeded, so
	// a failed/thrown R2 write can never leave a dangling photo_key pointing at
	// an object that doesn't exist.
	const owned = await submissionOwnedByDevice(platform.env.DB, submissionId, deviceId);
	if (!owned) return json({ error: 'unknown submission for this device' }, { status: 403 });

	const body = await request.arrayBuffer();
	if (body.byteLength === 0 || body.byteLength > MAX_BYTES)
		return json({ error: 'photo must be 1 byte – 5 MiB' }, { status: 413 });

	try {
		await platform.env.BUCKET.put(photoKey, body, { httpMetadata: { contentType } });
	} catch {
		return json({ error: 'failed to store photo' }, { status: 502 });
	}

	// Commit photo_key only now that the object is actually in R2.
	await attachPhoto(platform.env.DB, submissionId, deviceId, photoKey);
	return json({ ok: true });
};
