<script lang="ts">
	// The one tooltip (#4427), the way ContextMenuHost is the one menu. Placed
	// in the same flush that shows it, before a frame is painted, clear of its
	// button and inside the viewport (`placeTip`); a scroll or a resize takes
	// it away rather than leaving it behind. Chrome, so a neon hairline; the
	// app's own type; a 90 ms fade, and none for a rider who asked for stillness.
	import { fade } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { DUR } from '#lib/motion/tokens.ts';
	import { hideTip, placeTip, tip } from '#lib/tooltip.svelte.ts';

	let box = $state<HTMLDivElement | null>(null);
	let pos = $state<{ left: number; top: number } | null>(null);

	$effect(() => {
		const anchor = tip.anchor;
		const node = box;
		// Read so a label that changes under the tooltip re-places it.
		void tip.name;
		void tip.more;
		if (!anchor || !node) {
			pos = null;
			return;
		}
		pos = placeTip(
			anchor.getBoundingClientRect(),
			node.offsetWidth,
			node.offsetHeight,
			innerWidth,
			innerHeight,
		);
	});

	$effect(() => {
		if (!tip.anchor) return;
		const away = () => hideTip();
		window.addEventListener('scroll', away, true);
		window.addEventListener('resize', away);
		return () => {
			window.removeEventListener('scroll', away, true);
			window.removeEventListener('resize', away);
		};
	});
</script>

{#if tip.anchor}
	<div
		bind:this={box}
		role="tooltip"
		in:fade={{ duration: prefersReducedMotion.current ? 0 : DUR.press }}
		class="bg-surface-raised border-neon/40 text-ink pointer-events-none fixed z-[75] max-w-[min(18rem,calc(100vw-1rem))] rounded border px-2.5 py-1.5 text-base leading-snug"
		style:left="{pos?.left ?? 0}px"
		style:top="{pos?.top ?? 0}px"
		style:visibility={pos ? 'visible' : 'hidden'}
	>
		{#if tip.name}<p class="font-semibold">{tip.name}</p>{/if}
		{#if tip.more}<p class="text-muted text-sm">{tip.more}</p>{/if}
	</div>
{/if}
