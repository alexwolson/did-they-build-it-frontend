<script lang="ts">
	import { appState } from '$lib/app-state.svelte';
	import { haversineM, formatDistance } from '$lib/geo';
	import NavigationArrow from 'phosphor-svelte/lib/NavigationArrow';
	import PersonSimpleWalk from 'phosphor-svelte/lib/PersonSimpleWalk';

	// One device-agnostic "take me there" hand-off — no assuming Google or Apple.
	// iOS opens Apple Maps (its system default); Android emits a geo: URI, which
	// the OS routes to whatever maps app the user has set as their default (Google
	// Maps, Waze, OsmAnd, …); everything else gets a plain web maps link any
	// browser can open. Plus an in-app "how close am I" hint when we know where
	// the volunteer is.
	let { lat, lng }: { lat: number; lng: number } = $props();

	let distM = $derived(appState.userPos ? haversineM(appState.userPos, { lat, lng }) : null);
	let walkMin = $derived(distM === null ? null : Math.max(1, Math.round(distM / 80))); // ~80 m/min

	function mapsHref(): string {
		// This component only renders client-side (the sheet mounts after
		// sites.json loads), so navigator is always available here.
		const ua = navigator.userAgent;
		const isIOS =
			/iP(hone|ad|od)/.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
		if (isIOS) return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`;
		if (/Android/.test(ua)) return `geo:${lat},${lng}?q=${lat},${lng}`;
		return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
	}

	let href = $derived(mapsHref());
</script>

<a class="dir" {href} target="_blank" rel="noopener">
	<NavigationArrow weight="duotone" size={22} color="var(--brand)" />
	<span class="dir-label">Take me there</span>
	{#if distM !== null}
		<span class="walk">
			<PersonSimpleWalk weight="fill" size={15} />
			{formatDistance(distM)} · ~{walkMin} min
		</span>
	{/if}
</a>

<style>
	.dir {
		display: flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		border: 2px solid var(--line);
		background: var(--surface);
		border-radius: 12px;
		padding: 12px 14px;
		margin: 14px 0 4px;
		color: var(--ink);
		transition: transform 120ms ease;
	}
	.dir:active {
		transform: scale(0.98);
	}
	.dir-label {
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		font-size: 1.05rem;
	}
	.walk {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-left: auto;
		color: var(--ink-soft);
		font-weight: 700;
		font-size: 0.82rem;
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		.dir {
			transition: none;
		}
		.dir:active {
			transform: none;
		}
	}
</style>
