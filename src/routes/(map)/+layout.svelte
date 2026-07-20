<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type maplibregl from 'maplibre-gl';
	import MapCanvas from '$lib/components/MapCanvas.svelte';
	import NearbyList from '$lib/components/NearbyList.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { appState } from '$lib/app-state.svelte';
	import List from 'phosphor-svelte/lib/List';
	import NavigationArrow from 'phosphor-svelte/lib/NavigationArrow';
	import SunHorizon from 'phosphor-svelte/lib/SunHorizon';
	import HandTap from 'phosphor-svelte/lib/HandTap';
	import { createQueue, postSubmission } from '$lib/queue';
	import type { SitesCollection } from '$lib/types';

	let { children } = $props();

	// Load the static site data CLIENT-SIDE only. It must NOT be fetched during
	// SSR: on Cloudflare a Worker sub-requesting its own hostname for a static
	// asset fails with error 1042 (this passes in local dev/Miniflare, which
	// doesn't enforce that, and only surfaces on the real edge). A browser
	// fetching /data/sites.json is a normal CDN request, so doing it here keeps
	// the 118 KB payload off the JS bundle and the SSR HTML while avoiding 1042.
	// The map is client-deferred and needs no sites during SSR.
	async function loadSites() {
		try {
			const res = await fetch('/data/sites.json');
			if (res.ok) {
				const collection: SitesCollection = await res.json();
				appState.sites = collection.features;
			}
		} catch {
			// non-fatal: without sites the map simply shows no pins rather than crashing
		}
	}

	// Live community status: fetch aggregate verdict counts and merge into
	// appState so MapCanvas's $effect recolors pin rings and ConditionCard's
	// counts update. Non-fatal on failure — status is a progressive
	// enhancement over the static site data, never a hard dependency.
	async function refreshStatus() {
		try {
			const res = await fetch('/api/status');
			if (res.ok) {
				const data = (await res.json()) as { conditions?: typeof appState.statusCounts };
				// Guard the shape: a malformed/empty response must never make statusCounts
				// undefined — MapCanvas's $effect and ConditionCard both index it, so an
				// undefined here would crash the whole map render on the next poll.
				appState.statusCounts = data?.conditions ?? {};
			}
		} catch {
			// non-fatal: status is a progressive enhancement over static data
		}
	}

	// Offline-safe retry queue: flush on load, on reconnect, and periodically —
	// a flaky venue network never loses a report (shared KEY with ConditionCard's
	// own lazily-built queue, so both drain the same persisted localStorage list).
	onMount(() => {
		loadSites(); // client-side site data load (see loadSites for the SSR/1042 rationale)

		const queue = createQueue({
			storage: localStorage,
			post: postSubmission(fetch),
			onChange: (n) => (appState.pendingSync = n),
			onSent: refreshStatus
		});
		appState.pendingSync = queue.pending();
		queue.flush();

		// Show the tap hint once, only to first-time visitors, once sites exist.
		if (!localStorage.getItem('dtbi:seen-hint')) {
			showHint = true;
			setTimeout(dismissHint, 9000); // auto-clear if they don't tap
		}
		const onOnline = () => queue.flush();
		addEventListener('online', onOnline);
		const interval = setInterval(() => queue.pending() > 0 && queue.flush(), 15000);

		// ConditionCard builds its own queue instance (decoupled from this
		// layout) and dispatches this event after each of its own successful
		// sends, so a submit made straight from the site sheet also refreshes
		// the map/card counts immediately rather than waiting for the poll.
		refreshStatus();
		const statusInterval = setInterval(refreshStatus, 30000); // live-ish demo counts
		document.addEventListener('dtbi:sent', refreshStatus);

		return () => {
			removeEventListener('online', onOnline);
			clearInterval(interval);
			clearInterval(statusInterval);
			document.removeEventListener('dtbi:sent', refreshStatus);
		};
	});

	let geolocate: maplibregl.GeolocateControl | undefined;
	let listOpen = $state(false);
	// map.getCenter() is not reactive — mirror it into $state on moveend so the
	// fallback origin tracks where the user panned to.
	let mapCenter = $state({ lat: 43.645, lng: -79.39 });

	// Geolocation fallback: sort from map centre when we don't have a fix.
	let origin = $derived(appState.userPos ?? mapCenter);

	function nearMe() {
		const ok = geolocate?.trigger() ?? false;
		listOpen = true; // open regardless — falls back to distance-from-map-centre
		if (!ok) console.warn('geolocate control not ready');
	}

	// First-run orientation: a cold volunteer opens to a field of pins with no
	// cue to tap one. Show a one-time, dismissable hint (not a splash) that
	// clears itself the moment they open any site, and never returns.
	let showHint = $state(false);
	function dismissHint() {
		if (!showHint) return;
		showHint = false;
		localStorage.setItem('dtbi:seen-hint', '1');
	}
	function openSite(siteId: string) {
		dismissHint();
		goto(`/site/${siteId}`);
	}
</script>

<svelte:head>
	<title>Did They Build It?</title>
	<meta name="description" content="Check whether Toronto developers actually built what their approvals promised." />
</svelte:head>

<MapCanvas
	onSelect={openSite}
	registerMap={(m, g) => {
		geolocate = g;
		m.on('moveend', () => {
			const c = m.getCenter();
			mapCenter = { lat: c.lat, lng: c.lng };
		});
		// NOTE: do NOT open the list from geolocate/error events. With
		// trackUserLocation the geolocate event fires on every position update,
		// so opening here re-opened the list on each tracking tick and made it
		// impossible to dismiss. nearMe() already opens the list on the user's
		// tap (and falls back to map-centre sorting when a fix isn't available);
		// the open list re-sorts live via the reactive `origin` as userPos updates.
	}}
/>

<header class="brand">Did They Build It?</header>
{#if appState.totalChecked > 0}
	<div class="counter">
		<SunHorizon weight="duotone" size={18} />
		{appState.totalChecked} promises checked tonight
	</div>
{/if}
<button class="list-toggle" onclick={() => (listOpen = !listOpen)} aria-label="List of nearby sites">
	<List weight="bold" size={18} /> List
</button>
<button class="fab" onclick={nearMe}>
	<NavigationArrow weight="bold" size={18} /> Near me
</button>
<Toast />

{#if showHint}
	<button class="hint" onclick={dismissHint}>
		<HandTap weight="bold" size={18} class="hint-icon" /> Tap a pin to see what was promised
	</button>
{/if}

<NearbyList bind:open={listOpen} {origin} onSelect={openSite} />

{@render children()}

<style>
	.brand {
		position: fixed;
		top: 12px;
		left: 12px;
		background: var(--surface);
		border: 1px solid var(--line);
		padding: 8px 14px;
		border-radius: var(--radius);
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-weight: 700;
		color: var(--ink);
		z-index: 30;
	}
	.counter {
		position: fixed;
		top: 58px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--brand);
		color: #fff;
		border-radius: 999px;
		padding: 8px 16px;
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		font-size: 0.9rem;
		white-space: nowrap;
		z-index: 25;
	}
	.list-toggle {
		position: fixed;
		top: 12px;
		right: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--surface);
		border: 1px solid var(--line);
		padding: 8px 14px;
		border-radius: var(--radius);
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		color: var(--ink);
		cursor: pointer;
		z-index: 30;
	}
	.fab {
		position: fixed;
		right: 16px;
		bottom: calc(24px + env(safe-area-inset-bottom));
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--brand);
		color: #fff;
		border: 0;
		border-radius: 999px;
		padding: 16px 22px;
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 36, 'SOFT' 50, 'WONK' 1;
		font-size: 1.05rem;
		font-weight: 700;
		cursor: pointer;
		transition: transform 120ms ease;
		z-index: 30;
	}
	.fab:active { transform: scale(0.96); }

	/* First-run tap hint — centred low over the map, above the FAB, tap to dismiss. */
	.hint {
		position: fixed;
		left: 50%;
		bottom: calc(96px + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		max-width: min(88vw, 340px);
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--ink);
		color: #fff;
		border: 0;
		border-radius: 999px;
		padding: 12px 18px;
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-size: 0.95rem;
		font-weight: 600;
		text-align: left;
		line-height: 1.25;
		cursor: pointer;
		z-index: 40;
		animation: hint-in 320ms cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	.hint :global(.hint-icon) {
		flex-shrink: 0;
		animation: hint-bob 1.4s ease-in-out infinite;
	}
	@keyframes hint-in {
		from {
			opacity: 0;
			transform: translate(-50%, 12px);
		}
	}
	@keyframes hint-bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-3px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hint {
			animation: none;
		}
		.hint :global(.hint-icon) {
			animation: none;
		}
	}
</style>
