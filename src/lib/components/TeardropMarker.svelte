<script lang="ts">
	import type { Component } from 'svelte';

	// A flat teardrop map marker: white body, status-coloured outline, duotone
	// condition icon. The pointed corner sits at the bottom (marker anchor
	// 'bottom' places it on the coordinate). Status colour is updated imperatively
	// by MapCanvas via the .drop element, so it doesn't need to be reactive here.
	let { icon, status }: { icon: Component; status: string } = $props();
	const Icon = icon;
</script>

<div class="drop" style="border-color: {status}">
	<span class="ico"><Icon size={18} weight="duotone" color="var(--brand)" /></span>
</div>

<style>
	.drop {
		width: 34px;
		height: 34px;
		background: #fff;
		border: 3px solid;
		border-radius: 50% 50% 50% 0;
		transform: rotate(-45deg);
		display: grid;
		place-items: center;
		cursor: pointer;
	}
	.ico {
		transform: rotate(45deg);
		display: grid;
		place-items: center;
		line-height: 0;
	}
</style>
