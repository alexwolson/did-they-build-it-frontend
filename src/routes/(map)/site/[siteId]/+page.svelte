<script lang="ts">
	import SiteSheet from '$lib/components/SiteSheet.svelte';
	import { appState } from '$lib/app-state.svelte';

	let { data } = $props();
	// Prefer the route's own load data — resolved server-side from the layout's
	// sites.json fetch, so a cold SSR deep-link shows the real site. Fall back
	// to appState.sites (populated by the layout's client-only effect) only if
	// that lookup somehow came back empty, so client-side pin taps keep working
	// even if load data is ever stale.
	let site = $derived(
		data.site ?? appState.sites.find((f) => f.properties.siteId === data.siteId)
	);
</script>

<SiteSheet {site} />
