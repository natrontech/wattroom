<script lang="ts">
	// A panel that opens above the now bar from one of its buttons: the music
	// and the reactions. Escape or a press outside closes it; focus goes in.
	import type { Snippet } from 'svelte';
	import { countModal } from '#lib/modals.svelte.ts';

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
     of flying into a hole this panel paints over (YouTube's terms). It goes
     to its corner above the now bar, the corner this panel opens on, so the
     panel stops short of it (#4347): above the player with a gap, or beside
     it on a screen too short for both (a phone on its side). keepSize
     publishes the player's size only while it shows, so with nothing playing
     the panel sits on the bar in the corner, as it always did. -->
<div
	bind:this={panel}
	{@attach countModal}
	role="dialog"
	aria-label={label}
	class="panel fixed z-50 overflow-y-auto shadow-xl"
>
	{@render children()}
</div>

<style>
	[role='dialog'] {
		/* The player's corner is the bar, 1rem, then the player: 0.5rem
		   above that, or above the bar when there is no player. */
		--bottom: calc(
			var(--now-bar-h, 4rem) + 0.5rem + var(--pane-jukebox-dock-h, -1rem) + 1rem
		);
		--right: calc(0.75rem + var(--safe-right));
		right: var(--right);
		bottom: var(--bottom);
		width: min(24rem, calc(100vw - var(--right) - 0.75rem));
		max-height: min(
			70vh,
			calc(100dvh - var(--bottom) - 0.75rem - var(--safe-top))
		);
	}
	/* Above a 240 px player a phone on its side has a sliver left: there the
	   panel stands on the bar left of the player, 0.5rem clear of it. */
	@media (max-height: 30rem) {
		[role='dialog'] {
			--bottom: calc(var(--now-bar-h, 4rem) + 0.5rem);
			--right: calc(
				0.75rem + var(--safe-right) + var(--pane-jukebox-dock-w, -0.75rem) +
					0.75rem
			);
			max-height: calc(100dvh - var(--bottom) - 0.75rem - var(--safe-top));
		}
	}
</style>
