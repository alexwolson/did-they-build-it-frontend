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
	import Check from 'phosphor-svelte/lib/Check';
	import X from 'phosphor-svelte/lib/X';
	import Question from 'phosphor-svelte/lib/Question';
	import Camera from 'phosphor-svelte/lib/Camera';

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
	let TypeIcon = $derived(CONDITION_META[condition.type].icon);

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
	<p class="type">
		<TypeIcon size={24} weight="duotone" color="var(--brand)" />
		<span class="type-label">{CONDITION_META[condition.type].label}</span>
	</p>
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
			<Check size={22} weight="duotone" />
			<span class="v-label">It's there</span>
		</button>
		<button class="v absent" class:active={myVerdict === 'absent'} onclick={(e) => tap('absent', e)}>
			<X size={22} weight="duotone" />
			<span class="v-label">Not there</span>
		</button>
		<button class="v unclear" class:active={myVerdict === 'unclear'} onclick={(e) => tap('unclear', e)}>
			<Question size={22} weight="duotone" />
			<span class="v-label">Not sure</span>
		</button>
	</div>

	{#if myVerdict}
		<p class="thanks">
			Logged — you're in tonight's count.
			{#if appState.pendingSync > 0}<span class="sync"
					>{appState.pendingSync} report{appState.pendingSync > 1 ? 's' : ''} syncing…</span
				>{/if}
		</p>
		<div class="extras">
			<span class="extras-label">Add a photo or note? (optional)</span>
			<div class="extras-row">
				{#if sentId}
					<label class="photo-btn" class:done={photoState === 'done'}>
						<Camera size={18} weight="duotone" />
						{#if photoState === 'idle'}Photo{:else if photoState === 'uploading'}Uploading…{:else if photoState === 'done'}Added{:else}Retry{/if}
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
				{#if noteState === 'saved'}<span class="note-ok"><Check size={16} weight="bold" /></span>{/if}
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
				<span class="present" class:dim={counts.present === 0}>{counts.present} say it's there</span>
				<span class="absent" class:dim={counts.absent === 0}
					>{counts.absent} say{counts.absent === 1 ? 's' : ''} missing</span
				>
				{#if counts.unclear}<span class="unclear">{counts.unclear} unsure</span>{/if}
				{#if counts.photos > 0}<span class="photos"><Camera size={14} weight="duotone" /> {counts.photos}</span>{/if}
			</p>
		</div>
	{/if}
</article>

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 14px;
		margin-bottom: 12px;
	}
	.type {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 6px;
	}
	.type-label {
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 36, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		font-size: 1.05rem;
		color: var(--ink);
	}
	.desc {
		margin: 0 0 8px;
		color: var(--ink-soft);
	}
	.raw-toggle {
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 20, 'SOFT' 50, 'WONK' 1;
		background: none;
		border: 0;
		color: var(--brand);
		padding: 0;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
	}
	blockquote {
		font-size: 0.85rem;
		color: var(--ink-soft);
		border-left: 3px solid var(--line);
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
		border: 2px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius);
		padding: 12px 4px;
		color: var(--ink);
		cursor: pointer;
		transition:
			transform 120ms ease,
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease;
	}
	.v-label {
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 24, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.v:active {
		transform: scale(0.96);
	}
	/* Selected verdict: neutral-then-fill — the tap should feel decisive and
	   unmistakable, communicated purely through flat colour fill, no shadow. */
	.v.active {
		color: #fff;
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
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 28, 'SOFT' 50, 'WONK' 1;
		color: var(--present);
		font-weight: 600;
		margin: 10px 0 0;
	}
	.sync {
		font-family: var(--font-body);
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
		background: var(--line);
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
		align-items: center;
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
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--ink-soft);
		font-weight: 500;
		margin-left: auto;
	}
	.tally-labels .dim {
		color: var(--none); /* a zero count shouldn't read as an alarming red/green */
		font-weight: 500;
	}
	.extras {
		margin-top: 10px;
		border-top: 1px solid var(--line);
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
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--surface);
		border: 2px solid var(--line);
		border-radius: var(--radius);
		padding: 10px 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.photo-btn.done {
		border-color: var(--present);
		color: var(--present);
	}
	.note {
		flex: 1;
		border: 2px solid var(--line);
		border-radius: var(--radius);
		padding: 10px 12px;
		min-width: 0;
		background: var(--surface);
		color: var(--ink);
	}
	.note-ok {
		color: var(--present);
		font-weight: 700;
	}
</style>
