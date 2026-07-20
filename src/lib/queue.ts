import type { SubmissionPayload } from '$lib/types';

export interface StorageLike {
	getItem(k: string): string | null;
	setItem(k: string, v: string): void;
	removeItem(k: string): void;
}

export type PostResult = { ok: true; id: string } | { ok: false; status: number };
export type QueueResult =
	| { state: 'sent'; id: string }
	| { state: 'queued' }
	| { state: 'rejected' };

const KEY = 'dtbi:queue';

export function createQueue(deps: {
	storage: StorageLike;
	post: (p: SubmissionPayload) => Promise<PostResult>;
	onChange?: (pending: number) => void;
}) {
	const read = (): SubmissionPayload[] => JSON.parse(deps.storage.getItem(KEY) ?? '[]');
	const write = (items: SubmissionPayload[]) => {
		deps.storage.setItem(KEY, JSON.stringify(items));
		deps.onChange?.(items.length);
	};

	async function submit(p: SubmissionPayload): Promise<QueueResult> {
		try {
			const res = await deps.post(p);
			if (res.ok) return { state: 'sent', id: res.id };
			return { state: 'rejected' }; // 4xx/5xx response: retrying the same payload won't help
		} catch {
			write([...read(), p]); // network failure: keep it safe, retry later
			return { state: 'queued' };
		}
	}

	async function flush(): Promise<void> {
		const items = read();
		const remaining: SubmissionPayload[] = [];
		for (const p of items) {
			try {
				await deps.post(p); // upsert semantics server-side → retries are idempotent
			} catch {
				remaining.push(p);
			}
		}
		write(remaining);
	}

	return { submit, flush, pending: () => read().length };
}

export function postSubmission(fetchFn: typeof fetch) {
	return async (p: SubmissionPayload): Promise<PostResult> => {
		const res = await fetchFn('/api/submissions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(p)
		});
		if (!res.ok) return { ok: false, status: res.status };
		const { id } = (await res.json()) as { id: string };
		return { ok: true, id };
	};
}
