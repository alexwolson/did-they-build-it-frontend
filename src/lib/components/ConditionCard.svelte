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
		<button
			class="v present"
			class:active={myVerdict === 'present'}
			onclick={(e) => tap('present', e)}>✓ It's there</button
		>
		<button class="v absent" class:active={myVerdict === 'absent'} onclick={(e) => tap('absent', e)}
			>✗ Not there</button
		>
		<button
			class="v unclear"
			class:active={myVerdict === 'unclear'}
			onclick={(e) => tap('unclear', e)}>🤷 Can't tell</button
		>
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
		<p class="community">
			{counts.present} say it's there · {counts.absent} say missing
			{#if counts.photos > 0} · 📷 {counts.photos}{/if}
		</p>
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
		border: 2px solid #e2e8f0;
		background: var(--surface);
		border-radius: var(--radius);
		padding: 12px 4px;
		font-weight: 700;
		cursor: pointer;
		transition:
			transform 100ms ease,
			border-color 100ms ease;
	}
	.v:active {
		transform: scale(0.95);
	}
	.v.present.active {
		border-color: var(--present);
		background: #f0fdf4;
	}
	.v.absent.active {
		border-color: var(--absent);
		background: #fef2f2;
	}
	.v.unclear.active {
		border-color: var(--unclear);
		background: #fffbeb;
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
	.community {
		color: var(--ink-soft);
		font-size: 0.85rem;
		margin: 6px 0 0;
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
