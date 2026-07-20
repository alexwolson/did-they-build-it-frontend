<script lang="ts">
	import SiteSheet from '$lib/components/SiteSheet.svelte';
	import { appState } from '$lib/app-state.svelte';

	let { data } = $props();
	let site = $derived(appState.sites.find((f) => f.properties.siteId === data.siteId));
</script>

<SiteSheet {site} />
