<!-- src/lib/components/SiteSheet.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import ConditionCard from '$lib/components/ConditionCard.svelte';
	import type { SiteFeature } from '$lib/types';

	let { site }: { site: SiteFeature | undefined } = $props();
	const close = () => goto('/', { noScroll: true, keepFocus: true });

	// Swipe-down-to-dismiss. The .grab handle signals a draggable sheet, so make
	// it real. The gesture engages ONLY when the sheet's own content is scrolled
	// to the top and the finger moves down — otherwise native content scrolling
	// is left alone. While dragging we preventDefault (non-passive listener) so
	// the browser doesn't overscroll / pull-to-refresh the whole page instead.
	let dragY = $state(0);
	let dragging = $state(false);
	const CLOSE_PX = 90;

	function draggable(node: HTMLElement) {
		let startY = 0;
		let active = false;

		function onStart(e: TouchEvent) {
			if (node.scrollTop > 0) return; // content not at top → let it scroll
			active = true;
			dragging = true;
			startY = e.touches[0].clientY;
		}
		function onMove(e: TouchEvent) {
			if (!active) return;
			if (node.scrollTop > 0) { active = false; dragging = false; dragY = 0; return; }
			const dy = e.touches[0].clientY - startY;
			if (dy <= 0) { dragY = 0; return; } // upward → nothing to dismiss
			e.preventDefault(); // stop native scroll / pull-to-refresh during the dismiss drag
			dragY = dy;
		}
		function onEnd() {
			if (!active) return;
			active = false;
			dragging = false;
			if (dragY > CLOSE_PX) close();
			else dragY = 0; // spring back
		}

		node.addEventListener('touchstart', onStart, { passive: true });
		node.addEventListener('touchmove', onMove, { passive: false });
		node.addEventListener('touchend', onEnd);
		node.addEventListener('touchcancel', onEnd);
		return {
			destroy() {
				node.removeEventListener('touchstart', onStart);
				node.removeEventListener('touchmove', onMove);
				node.removeEventListener('touchend', onEnd);
				node.removeEventListener('touchcancel', onEnd);
			}
		};
	}
</script>

<div class="scrim" onclick={close} role="presentation"></div>
<section
	class="sheet"
	class:dragging
	use:draggable
	style="transform: translateY({dragY}px)"
	aria-label="Site details"
>
	<div class="grab"></div>
	{#if !site}
		<h2>Site not found</h2>
		<p>This link doesn't match a site in the current dataset.</p>
		<button class="back" onclick={close}>← Back to the map</button>
	{:else}
		{@const p = site.properties}
		<header>
			<h2>{p.address}</h2>
			<p class="meta">
				{#if p.appliedYear}Applied {p.appliedYear}{/if}
				{#if p.status} · {p.status}{/if}
				· Ward {p.ward}
			</p>
		</header>
		<p class="promise">The developer agreed to build:</p>
		{#each p.conditions as condition (condition.key)}
			<ConditionCard {condition} siteId={p.siteId} />
		{/each}
	{/if}
</section>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgb(15 23 42 / 0.25);
	}
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		max-height: 82dvh;
		overflow-y: auto;
		overscroll-behavior: contain; /* internal scroll never chains to the page */
		background: var(--bg);
		border-radius: var(--radius) var(--radius) 0 0;
		box-shadow: var(--shadow);
		padding: 8px 16px calc(20px + env(safe-area-inset-bottom));
		animation: rise 240ms cubic-bezier(0.2, 0.9, 0.3, 1); /* transform-only: compositor */
		will-change: transform;
	}
	/* Spring back to place when a dismiss-drag is released below the threshold.
	   No transition while actively dragging, so the sheet tracks the finger 1:1. */
	.sheet:not(.dragging) {
		transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	@keyframes rise {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: none;
		}
	}
	.grab {
		width: 40px;
		height: 4px;
		border-radius: 2px;
		background: #cbd5e1;
		margin: 4px auto 10px;
	}
	h2 {
		margin: 0;
		font-size: 1.3rem;
	}
	.meta {
		color: var(--ink-soft);
		margin: 4px 0 0;
		font-size: 0.9rem;
	}
	.promise {
		font-weight: 700;
		margin: 16px 0 8px;
	}
	.back {
		background: var(--brand);
		color: #fff;
		border: 0;
		border-radius: var(--radius);
		padding: 12px 18px;
	}
</style>
