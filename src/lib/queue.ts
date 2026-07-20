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

// Every persisted item carries a stable, unique nonce so flush() can identify
// exactly which stored items it resolved — even after storage was mutated
// concurrently by another createQueue instance (see flush() below). Plain
// crypto.randomUUID(), matching the existing convention in device.ts and
// server/submissions.ts: this app is only ever served over HTTPS (Cloudflare)
// or localhost dev, both secure contexts, so there's no realistic path where
// it's unavailable — adding a fallback here but not there would just be
// inconsistent, not safer.
type QueuedItem = SubmissionPayload & { nonce: string };
const stripNonce = ({ nonce: _nonce, ...payload }: QueuedItem): SubmissionPayload => payload;

export function createQueue(deps: {
	storage: StorageLike;
	post: (p: SubmissionPayload) => Promise<PostResult>;
	onChange?: (pending: number) => void;
}) {
	const read = (): QueuedItem[] => JSON.parse(deps.storage.getItem(KEY) ?? '[]');
	const write = (items: QueuedItem[]) => {
		deps.storage.setItem(KEY, JSON.stringify(items));
		deps.onChange?.(items.length);
	};

	async function submit(p: SubmissionPayload): Promise<QueueResult> {
		try {
			const res = await deps.post(p);
			if (res.ok) return { state: 'sent', id: res.id };
			return { state: 'rejected' }; // 4xx/5xx response: retrying the same payload won't help
		} catch {
			write([...read(), { ...p, nonce: crypto.randomUUID() }]); // network failure: keep it safe, retry later
			return { state: 'queued' };
		}
	}

	async function flush(): Promise<void> {
		// Snapshot once, but track outcomes by nonce rather than rebuilding the
		// array positionally — another createQueue instance (a different
		// ConditionCard, or the layout's interval flush) shares this same
		// storage key and may append a new item via submit() while these
		// awaits are in flight. Writing back a stale snapshot would silently
		// discard that concurrently-queued report.
		const items = read();
		const resolvedNonces = new Set<string>();
		for (const item of items) {
			try {
				const res = await deps.post(stripNonce(item)); // upsert semantics server-side → retries are idempotent
				if (res.ok) {
					resolvedNonces.add(item.nonce); // sent — terminal
				} else if (res.status >= 400 && res.status < 500) {
					resolvedNonces.add(item.nonce); // permanently rejected — retrying can't help, terminal
				}
				// else: resolved 5xx — transient server error, leave queued for retry
			} catch {
				// thrown network error — offline, leave queued for retry
			}
		}
		// Re-read immediately before writing so any items appended (or removed)
		// concurrently since the snapshot are preserved; only remove the nonces
		// this flush actually resolved.
		const latest = read();
		write(latest.filter((item) => !resolvedNonces.has(item.nonce)));
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
