<script lang="ts">
	// The jukebox is FRAME-LEVEL, not a place, and that is a licence
	// requirement rather than a preference.
	//
	// WATTROOM.md's YouTube RMF terms: the player tile is ≥200×200, always
	// visible while media plays, nothing overlaid on it, and no auto-advance
	// while it is offscreen. A place would go offscreen the moment you opened
	// another one. And there can only be ONE instance — moving an iframe
	// between DOM parents remounts it and stops playback — so it cannot travel
	// into the Training focus slot either. It docks, and it stays put.
	//
	// 200 px tall at 16:9 needs 356 px wide, which is why this cannot live in
	// the 240 px sidebar or the 272 px people column. It floats.
	//
	// It also stops fighting for its corner: ADR-0020 retires the DM drawer,
	// which is what the `right-[392px]` in DmDrawer.svelte was dodging.
	import { Pause, SkipForward, ThumbsUp } from '@lucide/svelte';

	let { collapsed = false }: { collapsed?: boolean } = $props();
</script>

<div
	class="border-neon/25 bg-surface absolute right-4 bottom-4 z-30 w-[360px] overflow-hidden rounded-lg border shadow-2xl"
>
	{#if !collapsed}
		<!-- ≥200×200 and unobstructed: no HUD, no scrim, no caption over it. -->
		<div class="relative aspect-video w-full">
			<div
				class="h-full w-full"
				style="background: radial-gradient(120% 90% at 60% 30%, oklch(0.40 0.15 320), oklch(0.13 0.05 300))"
			></div>
		</div>
	{/if}
	<div class="flex items-center gap-2 px-3 py-2">
		<span class="min-w-0 flex-1">
			<span class="block truncate text-xs font-medium"
				>Kavinsky — Nightcall</span
			>
			<span class="text-muted block truncate text-[10px]"
				>queued by Tobi · up next: The Midnight</span
			>
		</span>
		<button class="text-muted hover:text-ink shrink-0" aria-label="vote"
			><ThumbsUp size={14} /></button
		>
		<button class="text-muted hover:text-ink shrink-0" aria-label="pause"
			><Pause size={14} /></button
		>
		<button class="text-muted hover:text-ink shrink-0" aria-label="skip"
			><SkipForward size={14} /></button
		>
	</div>
</div>
