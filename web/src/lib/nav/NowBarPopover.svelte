<script lang="ts">
	// A panel that opens above the now bar from one of its buttons: the music
	// and the reactions. Escape or a press outside closes it; focus goes in.
	import type { Snippet } from 'svelte';
	import { countModal } from '$lib/modals.svelte';

	let {
		label,
		anchor,
		onclose,
		children,
	}: {
		label: string;
		/** The button that opened it: a press on it is its own toggle. */
		anchor: HTMLElement | null;
		onclose: () => void;
		children: Snippet;
	} = $props();

	let panel = $state<HTMLElement | null>(null);

	function outside(event: PointerEvent) {
		const target = event.target as Node;
		if (panel?.contains(target) || anchor?.contains(target)) return;
		onclose();
	}
	$effect(() => {
		queueMicrotask(() =>
			panel
				?.querySelector<HTMLElement>('button, input, a[href]')
				?.focus({ preventScroll: true }),
		);
	});
</script>

<svelte:window
	onkeydown={(e) => e.key === 'Escape' && onclose()}
	onpointerdown={outside}
/>

<!-- Counted as covering (countModal): the jukebox's player un-seats instead
     of flying into a hole this panel paints over (YouTube's terms). -->
<div
	bind:this={panel}
	{@attach countModal}
	role="dialog"
	aria-label={label}
	class="panel fixed right-[calc(0.75rem+var(--safe-right))] bottom-[calc(var(--now-bar-h,4rem)+0.5rem)] z-50 max-h-[70vh] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto shadow-xl"
>
	{@render children()}
</div>
