<!-- src/lib/components/Toast.svelte -->
<script lang="ts">
	import Confetti from 'phosphor-svelte/lib/Confetti';
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
		<Confetti size={18} weight="duotone" />
		<span
			>{#if appState.tally === 1}Nice — your first promise checked tonight!{:else}That's {appState.tally}
				promises checked tonight{/if}</span
		>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 88vw;
		background: var(--ink);
		color: #fff;
		padding: 10px 18px;
		border-radius: 999px;
		font-family: var(--font-disp);
		font-variation-settings: 'opsz' 30, 'SOFT' 50, 'WONK' 1;
		font-weight: 600;
		animation: pop 200ms ease;
		z-index: 50;
	}
	.toast :global(svg) {
		flex-shrink: 0;
	}
	@keyframes pop {
		from {
			transform: translateX(-50%) scale(0.8);
			opacity: 0;
		}
	}
</style>
