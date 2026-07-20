<!-- src/lib/components/NearbyList.svelte -->
<script lang="ts">
	import { formatDistance, sortByDistance } from '$lib/geo';
	import { appState } from '$lib/app-state.svelte';
	import { CONDITION_META } from '$lib/condition-meta';

	let {
		open = $bindable(false),
		origin,
		onSelect
	}: {
		open: boolean;
		origin: { lat: number; lng: number };
		onSelect: (siteId: string) => void;
	} = $props();

	let sorted = $derived(sortByDistance(appState.sites, origin).slice(0, 30));
</script>

{#if open}
	<div class="scrim" onclick={() => (open = false)} role="presentation"></div>
	<section class="sheet" aria-label="Nearby sites">
		<div class="grab"></div>
		<h2>Nearby promises</h2>
		<ul>
			{#each sorted as { site, distanceM } (site.properties.siteId)}
				{@const p = site.properties}
				<li>
					<button onclick={() => { open = false; onSelect(p.siteId); }}>
						<span class="dist">{formatDistance(distanceM)}</span>
						<span class="addr">{p.address}</span>
						<span class="types">
							{CONDITION_META[p.conditions[0].type].emoji}
							{#if p.conditions.length > 1}+{p.conditions.length - 1} more{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.scrim { position: fixed; inset: 0; background: rgb(15 23 42 / 0.25); }
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		max-height: 70dvh;
		overflow-y: auto;
		background: var(--surface);
		border-radius: var(--radius) var(--radius) 0 0;
		box-shadow: var(--shadow);
		padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
		animation: rise 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes rise { from { transform: translateY(100%); } to { transform: translateY(0); } }
	@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
	.grab { width: 40px; height: 4px; border-radius: 2px; background: #cbd5e1; margin: 4px auto 10px; }
	h2 { font-size: 1rem; margin: 0 0 8px; color: var(--ink-soft); }
	ul { list-style: none; margin: 0; padding: 0; }
	li button {
		display: grid;
		grid-template-columns: 4.5rem 1fr auto;
		gap: 10px;
		align-items: center;
		width: 100%;
		padding: 12px 4px;
		background: none;
		border: 0;
		border-bottom: 1px solid #e2e8f0;
		text-align: left;
		cursor: pointer;
	}
	.dist { color: var(--brand); font-weight: 700; font-variant-numeric: tabular-nums; }
	.addr { font-weight: 600; }
	.types { color: var(--ink-soft); font-size: 0.85rem; }
</style>
