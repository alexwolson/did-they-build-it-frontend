<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let canvas: HTMLCanvasElement;
	let url = $state('');

	onMount(async () => {
		url = location.origin;
		await QRCode.toCanvas(canvas, url, { width: 480, margin: 2 });
	});
</script>

<svelte:head><title>Did They Build It? — QR</title></svelte:head>

<main>
	<h1>Did They Build It?</h1>
	<p>Toronto developers made promises. Help check them.</p>
	<canvas bind:this={canvas}></canvas>
	<p class="url">{url}</p>
</main>

<style>
	main { min-height: 100dvh; display: grid; place-content: center; text-align: center; gap: 12px; padding: 24px; }
	h1 { margin: 0; }
	canvas { margin: 0 auto; max-width: 100%; }
	.url { font-size: 1.3rem; font-weight: 700; color: var(--brand); }
	@media print { .url { color: #000; } }
</style>
