<script lang="ts">
	import { goto } from '$app/navigation';
	import MapCanvas from '$lib/components/MapCanvas.svelte';
	import { appState } from '$lib/app-state.svelte';

	let { data, children } = $props();
	$effect.pre(() => {
		appState.sites = data.sites.features;
	});
</script>

<svelte:head>
	<title>Did They Build It?</title>
	<meta name="description" content="Check whether Toronto developers actually built what their approvals promised." />
</svelte:head>

<MapCanvas onSelect={(siteId) => goto(`/site/${siteId}`)} />

<header class="brand">Did They Build It?</header>

{@render children()}

<style>
	.brand {
		position: fixed;
		top: 12px;
		left: 12px;
		background: var(--surface);
		padding: 8px 14px;
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		font-weight: 700;
	}
</style>
