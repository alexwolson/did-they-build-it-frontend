<script lang="ts">
	import { appState } from '$lib/app-state.svelte';
	import { haversineM, formatDistance } from '$lib/geo';
	import NavigationArrow from 'phosphor-svelte/lib/NavigationArrow';
	import PersonSimpleWalk from 'phosphor-svelte/lib/PersonSimpleWalk';
	import GoogleLogo from 'phosphor-svelte/lib/GoogleLogo';
	import AppleLogo from 'phosphor-svelte/lib/AppleLogo';

	// Hand off to the device's maps app for real walking directions (a proper
	// turn-by-turn engine is overkill for short campus walks) — with an in-app
	// "how close am I" hint when we know the volunteer's location.
	let { lat, lng }: { lat: number; lng: number } = $props();

	let distM = $derived(appState.userPos ? haversineM(appState.userPos, { lat, lng }) : null);
	let walkMin = $derived(distM === null ? null : Math.max(1, Math.round(distM / 80))); // ~80 m/min

	const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
	const amaps = `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
</script>

<div class="dir">
	<div class="dir-head">
		<NavigationArrow weight="duotone" size={20} color="var(--brand)" />
		<span class="dir-title">Take me there</span>
		{#if distM !== null}
			<span class="walk">
				<PersonSimpleWalk weight="duotone" size={16} />
				{formatDistance(distM)} · ~{walkMin} min walk
			</span>
		{/if}
	</div>
	<div class="dir-btns">
		<a class="dir-btn" href={gmaps} target="_blank" rel="noopener">
			<GoogleLogo weight="duotone" size={18} /> Google Maps
		</a>
		<a class="dir-btn" href={amaps} target="_blank" rel="noopener">
			<AppleLogo weight="duotone" size={18} /> Apple Maps
		</a>
	</div>
</div>

<style>
	.dir {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 12px 13px;
		margin: 14px 0 4px;
	}
	.dir-head {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.dir-title {
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		font-size: 1rem;
		color: var(--ink);
	}
	.walk {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-left: auto;
		color: var(--ink-soft);
		font-weight: 700;
		font-size: 0.82rem;
	}
	.dir-btns {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.dir-btn {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		text-decoration: none;
		border: 2px solid var(--line);
		background: var(--surface);
		border-radius: 12px;
		padding: 10px 8px;
		color: var(--ink);
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 24, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		font-size: 0.9rem;
		transition: transform 120ms ease;
	}
	.dir-btn:active {
		transform: scale(0.97);
	}
	@media (prefers-reduced-motion: reduce) {
		.dir-btn {
			transition: none;
		}
		.dir-btn:active {
			transform: none;
		}
	}
</style>
