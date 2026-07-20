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

	it('does not clobber a report queued by a concurrent submit() while flush() is in flight', async () => {
		// Regression test for finding 1: flush() used to snapshot the queue with a
		// single read(), await each POST, then unconditionally write() the stale
		// snapshot back — silently discarding anything appended to storage while
		// those awaits were in flight (e.g. another ConditionCard's instance, or
		// the layout's interval flush, submitting a new report mid-flush).
		const storage = memStorage();
		const old: SubmissionPayload = { ...payload, conditionKey: 'old' };
		const fresh: SubmissionPayload = { ...payload, conditionKey: 'fresh' };

		// Seed the queue with the OLD item directly (simulating a prior offline submit).
		const seeder = createQueue({ storage, post: vi.fn().mockRejectedValue(new Error('offline')) });
		await seeder.submit(old);
		expect(seeder.pending()).toBe(1);

		// Start a flush whose POST for the old item hangs until we release it.
		let releaseFlushPost: (() => void) | undefined;
		const flushPost = vi.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseFlushPost = () => resolve({ ok: true, id: 'sent-old' });
				})
		);
		const flushingQueue = createQueue({ storage, post: flushPost });
		const flushPromise = flushingQueue.flush();

		// While the flush's POST is still pending, a second (independent) queue
		// instance — same shared storage key — queues a NEW report that fails to send.
		const submitter = createQueue({ storage, post: vi.fn().mockRejectedValue(new Error('offline')) });
		await submitter.submit(fresh);
		expect(JSON.parse(storage.getItem('dtbi:queue')!)).toHaveLength(2);

		// Now let the in-flight flush POST resolve and let flush() finish writing.
		releaseFlushPost?.();
		await flushPromise;

		// The old item was sent, so it should be gone. The freshly-queued item was
		// NOT part of the flush's snapshot and must survive — not be clobbered by
		// flush()'s final write().
		const remaining = JSON.parse(storage.getItem('dtbi:queue')!) as SubmissionPayload[];
		expect(remaining).toHaveLength(1);
		expect(remaining[0].conditionKey).toBe('fresh');
		expect(flushingQueue.pending()).toBe(1);
	});

	it('retains a report in the queue when flush() gets a transient 5xx', async () => {
		const storage = memStorage();
		const seeder = createQueue({ storage, post: vi.fn().mockRejectedValue(new Error('offline')) });
		await seeder.submit(payload);
		expect(seeder.pending()).toBe(1);

		const q = createQueue({ storage, post: vi.fn().mockResolvedValue({ ok: false, status: 500 }) });
		await q.flush();
		expect(q.pending()).toBe(1);
	});

	it('drops a report from the queue when flush() gets a permanent 4xx', async () => {
		const storage = memStorage();
		const seeder = createQueue({ storage, post: vi.fn().mockRejectedValue(new Error('offline')) });
		await seeder.submit(payload);
		expect(seeder.pending()).toBe(1);

		const q = createQueue({ storage, post: vi.fn().mockResolvedValue({ ok: false, status: 400 }) });
		await q.flush();
		expect(q.pending()).toBe(0);
	});
});
