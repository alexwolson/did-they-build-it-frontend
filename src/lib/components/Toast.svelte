<!-- src/lib/components/Toast.svelte -->
<script lang="ts">
	import { appState } from '$lib/app-state.svelte';

	let visible = $state(false);
	let timer: ReturnType<typeof setTimeout>;
	$effect(() => {
		if (appState.tally > 0) {
			visible = true;
			clearTimeout(timer);
			timer = setTimeout(() => (visible = false), 2500);
		}
	});
</script>

{#if visible}
	<div class="toast" role="status">
		{#if appState.tally === 1}Nice — your first promise checked tonight! 🎉{:else}That's {appState.tally} promises checked tonight 🎉{/if}
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--ink);
		color: #fff;
		padding: 10px 18px;
		border-radius: 999px;
		box-shadow: var(--shadow);
		animation: pop 200ms ease;
		z-index: 50;
	}
	@keyframes pop {
		from {
			transform: translateX(-50%) scale(0.8);
			opacity: 0;
		}
	}
</style>
