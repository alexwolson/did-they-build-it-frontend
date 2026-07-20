<script lang="ts">
	// A flat cluster marker: teal circle, white ring, Fraunces count.
	let { count }: { count: number } = $props();
	const size = count >= 100 ? 52 : count >= 25 ? 46 : 40;
</script>

<div class="cl" style="width: {size}px; height: {size}px">{count}</div>

<style>
	.cl {
		background: var(--brand);
		color: #fff;
		border: 3px solid #fff;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
	}
</style>
