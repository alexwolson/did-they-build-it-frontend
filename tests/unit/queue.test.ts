import { describe, expect, it, vi } from 'vitest';
import { createQueue, type StorageLike } from '../../src/lib/queue';
import type { SubmissionPayload } from '../../src/lib/types';

const memStorage = (): StorageLike => {
	const m = new Map<string, string>();
	return {
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => void m.set(k, v),
		removeItem: (k) => void m.delete(k)
	};
};

const payload: SubmissionPayload = {
	deviceId: 'd',
	siteId: 's',
	conditionKey: 'k',
	verdict: 'present'
};

describe('createQueue', () => {
	it('returns sent with the server id when POST succeeds', async () => {
		const post = vi.fn().mockResolvedValue({ ok: true, id: 'server-id' });
		const q = createQueue({ storage: memStorage(), post });
		expect(await q.submit(payload)).toEqual({ state: 'sent', id: 'server-id' });
		expect(q.pending()).toBe(0);
	});

	it('queues on network failure and reports pending', async () => {
		const post = vi.fn().mockRejectedValue(new Error('offline'));
		const q = createQueue({ storage: memStorage(), post });
		expect(await q.submit(payload)).toEqual({ state: 'queued' });
		expect(q.pending()).toBe(1);
	});

	it('flush drains the queue once the network recovers', async () => {
		const post = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue({ ok: true, id: 'x' });
		const storage = memStorage();
		const q = createQueue({ storage, post });
		await q.submit(payload);
		expect(q.pending()).toBe(1);
		await q.flush();
		expect(q.pending()).toBe(0);
	});

	it('does NOT queue on a 4xx rejection (server said no — retrying cannot help)', async () => {
		const post = vi.fn().mockResolvedValue({ ok: false, status: 400 });
		const q = createQueue({ storage: memStorage(), post });
		expect(await q.submit(payload)).toEqual({ state: 'rejected' });
		expect(q.pending()).toBe(0);
	});

	it('persists the queue across instances (page reloads)', async () => {
		const storage = memStorage();
		const failing = createQueue({ storage, post: vi.fn().mockRejectedValue(new Error('x')) });
		await failing.submit(payload);
		const revived = createQueue({ storage, post: vi.fn().mockResolvedValue({ ok: true, id: 'y' }) });
		expect(revived.pending()).toBe(1);
		await revived.flush();
		expect(revived.pending()).toBe(0);
	});
});
