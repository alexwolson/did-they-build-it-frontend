<script lang="ts">
	import SiteSheet from '$lib/components/SiteSheet.svelte';
	import { appState } from '$lib/app-state.svelte';

	let { data } = $props();
	// Site data is loaded client-side into appState (see (map)/+layout.svelte).
	// After a pin tap the map is already loaded, so this resolves immediately;
	// on a cold deep-link it resolves once loadSites() populates appState.
	let site = $derived(appState.sites.find((f) => f.properties.siteId === data.siteId));
</script>

<SiteSheet {site} />
