<!-- src/lib/components/ConditionCard.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';
	import { burst } from '$lib/confetti';
	import { deviceId } from '$lib/device';
	import { createQueue, postSubmission } from '$lib/queue';
	import { appState } from '$lib/app-state.svelte';
	import { CONDITION_META } from '$lib/condition-meta';
	import { downscale } from '$lib/photo';
	import type { SiteCondition, Verdict } from '$lib/types';

	let { condition, siteId }: { condition: SiteCondition; siteId: string } = $props();

	// localStorage doesn't exist during SSR (the /site/[siteId] deep link renders
	// server-side) — build the queue lazily inside event handlers, which are
	// browser-only, and guard the initial read with `browser`.
	let _queue: ReturnType<typeof createQueue> | undefined;
	const queue = () =>
		(_queue ??= createQueue({
			storage: localStorage,
			post: postSubmission(fetch),
			onChange: (n) => (appState.pendingSync = n),
			// Decoupled from the layout: dispatch an event rather than importing
			// refreshStatus directly, so the layout owns when/how status refreshes.
			onSent: () => document.dispatchEvent(new CustomEvent('dtbi:sent'))
		}));

	// idle → sending → sent | queued; myVerdict persists per device via localStorage
	let myVerdict = $state<Verdict | null>(
		browser ? ((localStorage.getItem(`dtbi:v:${condition.key}`) as Verdict | null) ?? null) : null
	);
	let sentId = $state<string | null>(null);
	let showRaw = $state(false);

	let photoState = $state<'idle' | 'uploading' | 'done' | 'failed'>('idle');
	let note = $state('');
	let noteState = $state<'idle' | 'saved'>('idle');

	let counts = $derived(appState.statusCounts[condition.key]);

	async function tap(verdict: Verdict, e: MouseEvent) {
		const isUpdate = myVerdict !== null;
		myVerdict = verdict; // optimistic: < 50 ms acknowledgment
		localStorage.setItem(`dtbi:v:${condition.key}`, verdict);
		navigator.vibrate?.(15);
		if (!isUpdate) {
			burst(e.clientX, e.clientY);
			appState.tally += 1;
		}
		const result = await queue().submit({
			deviceId: deviceId(),
			siteId,
			conditionKey: condition.key,
			verdict,
			lat: appState.userPos?.lat ?? null,
			lng: appState.userPos?.lng ?? null,
			accuracyM: appState.userPos?.accuracyM ?? null
		});
		if (result.state === 'sent') sentId = result.id;
	}

	async function addPhoto(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file || !sentId) return;
		photoState = 'uploading';
		try {
			const blob = await downscale(file);
			const res = await fetch(`/api/photos?submission=${sentId}&device=${deviceId()}`, {
				method: 'POST',
				headers: { 'content-type': 'image/jpeg' },
				body: blob
			});
			photoState = res.ok ? 'done' : 'failed';
		} catch {
			photoState = 'failed'; // verdict already stands — photo failure is non-fatal
		}
	}

	async function saveNote() {
		if (!note.trim() || !myVerdict) return;
		// Re-submit with the note; the server upserts (same device+condition).
		await queue().submit({
			deviceId: deviceId(),
			siteId,
			conditionKey: condition.key,
			verdict: myVerdict,
			note: note.trim().slice(0, 500),
			lat: appState.userPos?.lat ?? null,
			lng: appState.userPos?.lng ?? null,
			accuracyM: appState.userPos?.accuracyM ?? null
		});
		noteState = 'saved';
	}
</script>

<article class="card">
	<p class="type">{CONDITION_META[condition.type].emoji} {CONDITION_META[condition.type].label}</p>
	<p class="desc">{condition.description}</p>
	<button class="raw-toggle" onclick={() => (showRaw = !showRaw)}>
		{showRaw ? 'Hide' : 'Show'} exact wording
	</button>
	{#if showRaw}
		<blockquote>
			{condition.rawText} <a href={condition.sourceUrl} target="_blank" rel="noopener">source ↗</a>
		</blockquote>
	{/if}

	<div class="verdicts" role="group" aria-label="Is it there?">
		<button class="v present" class:active={myVerdict === 'present'} onclick={(e) => tap('present', e)}>
			<span class="v-icon">✓</span><span class="v-label">It's there</span>
		</button>
		<button class="v absent" class:active={myVerdict === 'absent'} onclick={(e) => tap('absent', e)}>
			<span class="v-icon">✗</span><span class="v-label">Not there</span>
		</button>
		<button class="v unclear" class:active={myVerdict === 'unclear'} onclick={(e) => tap('unclear', e)}>
			<span class="v-icon">🤷</span><span class="v-label">Not sure</span>
		</button>
	</div>

	{#if myVerdict}
		<p class="thanks">
			Recorded — thank you!
			{#if appState.pendingSync > 0}<span class="sync"
					>{appState.pendingSync} report{appState.pendingSync > 1 ? 's' : ''} syncing…</span
				>{/if}
		</p>
		<div class="extras">
			<span class="extras-label">Add a photo or note? (optional)</span>
			<div class="extras-row">
				{#if sentId}
					<label class="photo-btn" class:done={photoState === 'done'}>
						{#if photoState === 'idle'}📷 Photo{:else if photoState === 'uploading'}Uploading…{:else if photoState === 'done'}📷 Added ✓{:else}Retry 📷{/if}
						<input type="file" accept="image/*" capture="environment" onchange={addPhoto} hidden />
					</label>
				{/if}
				<input
					class="note"
					type="text"
					maxlength="500"
					placeholder="One-line note…"
					bind:value={note}
					onblur={saveNote}
				/>
				{#if noteState === 'saved'}<span class="note-ok">✓</span>{/if}
			</div>
		</div>
	{/if}

	{#if counts && counts.present + counts.absent + counts.unclear > 0}
		<div class="community">
			<div class="tally-bar" aria-hidden="true">
				{#if counts.present}<span class="seg present" style="flex: {counts.present}"></span>{/if}
				{#if counts.absent}<span class="seg absent" style="flex: {counts.absent}"></span>{/if}
				{#if counts.unclear}<span class="seg unclear" style="flex: {counts.unclear}"></span>{/if}
			</div>
			<p class="tally-labels">
				<span class="present" class:dim={counts.present === 0}>{counts.present} here</span>
				<span class="absent" class:dim={counts.absent === 0}>{counts.absent} missing</span>
				{#if counts.unclear}<span class="unclear">{counts.unclear} unsure</span>{/if}
				{#if counts.photos > 0}<span class="photos">📷 {counts.photos}</span>{/if}
			</p>
		</div>
	{/if}
</article>

<style>
	.card {
		background: var(--surface);
		border-radius: var(--radius);
		box-shadow: 0 2px 10px rgb(15 23 42 / 0.07);
		padding: 14px;
		margin-bottom: 12px;
	}
	.type {
		font-weight: 700;
		margin: 0 0 6px;
	}
	.desc {
		margin: 0 0 8px;
	}
	.raw-toggle {
		background: none;
		border: 0;
		color: var(--brand);
		padding: 0;
		font-size: 0.85rem;
		cursor: pointer;
	}
	blockquote {
		font-size: 0.85rem;
		color: var(--ink-soft);
		border-left: 3px solid #e2e8f0;
		margin: 8px 0;
		padding-left: 10px;
	}
	.verdicts {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
		margin-top: 12px;
	}
	.v {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		border: 2px solid #e2e8f0;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 12px 4px;
		color: var(--ink);
		cursor: pointer;
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			background 120ms ease,
			box-shadow 120ms ease;
	}
	.v-icon {
		font-size: 1.4rem;
		line-height: 1;
	}
	.v-label {
		font-size: 0.9rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.v:active {
		transform: scale(0.94);
	}
	/* Selected verdict: filled, white text, and a subtle pop — the tap should
	   feel decisive and rewarding, and the choice should be unmistakable. */
	.v.active {
		color: #fff;
		transform: scale(1.03);
		box-shadow: 0 5px 16px rgb(15 23 42 / 0.18);
	}
	.v.present.active {
		border-color: var(--present);
		background: var(--present);
	}
	.v.absent.active {
		border-color: var(--absent);
		background: var(--absent);
	}
	.v.unclear.active {
		border-color: var(--unclear);
		background: var(--unclear);
	}
	@media (prefers-reduced-motion: reduce) {
		.v {
			transition: background 120ms ease, border-color 120ms ease;
		}
		.v.active,
		.v:active {
			transform: none;
		}
	}
	.thanks {
		color: var(--present);
		font-weight: 600;
		margin: 10px 0 0;
	}
	.sync {
		color: var(--unclear);
		font-weight: 400;
		font-size: 0.85rem;
		margin-left: 6px;
	}
	/* Community consensus — the social payoff. A proportional bar of what the
	   crowd has reported so far, so agreement is felt at a glance, not read. */
	.community {
		margin: 12px 0 0;
	}
	.tally-bar {
		display: flex;
		gap: 2px;
		height: 8px;
		border-radius: 999px;
		overflow: hidden;
		background: #e2e8f0;
	}
	.tally-bar .seg {
		display: block;
	}
	.tally-bar .seg.present {
		background: var(--present);
	}
	.tally-bar .seg.absent {
		background: var(--absent);
	}
	.tally-bar .seg.unclear {
		background: var(--unclear);
	}
	.tally-labels {
		display: flex;
		gap: 12px;
		margin: 6px 0 0;
		font-size: 0.82rem;
		font-weight: 600;
	}
	.tally-labels .present {
		color: var(--present);
	}
	.tally-labels .absent {
		color: var(--absent);
	}
	.tally-labels .unclear {
		color: var(--unclear);
	}
	.tally-labels .photos {
		color: var(--ink-soft);
		font-weight: 500;
		margin-left: auto;
	}
	.tally-labels .dim {
		color: #94a3b8; /* a zero count shouldn't read as an alarming red/green */
		font-weight: 500;
	}
	.extras {
		margin-top: 10px;
		border-top: 1px dashed #e2e8f0;
		padding-top: 10px;
	}
	.extras-label {
		font-size: 0.8rem;
		color: var(--ink-soft);
	}
	.extras-row {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 6px;
	}
	.photo-btn {
		background: var(--surface);
		border: 2px solid #e2e8f0;
		border-radius: var(--radius);
		padding: 10px 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.photo-btn.done {
		border-color: var(--present);
	}
	.note {
		flex: 1;
		border: 2px solid #e2e8f0;
		border-radius: var(--radius);
		padding: 10px 12px;
		min-width: 0;
	}
	.note-ok {
		color: var(--present);
		font-weight: 700;
	}
</style>
