<script lang="ts">
	import { Music } from '@lucide/svelte';
	import { keepSize } from '$lib/pane';
	import { roomConnection } from '$lib/room/connection.svelte';
	import { playerInfo } from '$lib/room/jukebox-player.svelte';
	import {
		claimSeat,
		seating,
		type SeatName,
	} from '$lib/room/jukebox-seat.svelte';

	/**
	 * The hole the player flies into (#316). It reserves the space and says
	 * whose it is — the picture is the dock's one iframe, positioned over this
	 * box: never drawn into it, and never drawn over (RMF).
	 *
	 * The room seat is the deterministic spot: always here, always above the
	 * cams, in the room's chrome violet so it reads as the jukebox and not as
	 * one more rider. Its height is dragged and remembered like any other pane;
	 * everything that has to sit under the picture sits under the frame.
	 */
	let { name }: { name: SeatName } = $props();

	const big = $derived(name === 'room');
	const title = $derived(
		roomConnection.current?.live.tick?.jukebox?.current?.title ?? '',
	);
	/** The player only takes a seat that fits it — say so when it went floating. */
	const taken = $derived(seating.at === name);
</script>

<div class="flex min-w-0 flex-col {big ? 'mb-3' : ''}">
	<div
		class="ring-neon/40 flex flex-col overflow-hidden rounded-lg p-1.5 ring-1 {big
			? 'bg-surface-raised pb-4'
			: ''}"
		style={big ? 'height: 46vh; min-height: 232px; resize: vertical' : ''}
		{@attach (node) => (big ? keepSize(node, 'jukebox-room') : undefined)}
	>
		<div class="text-muted flex min-w-0 items-center gap-1.5 px-0.5 pb-1">
			<Music size={12} class="text-neon shrink-0" />
			<span class="eyebrow shrink-0">jukebox</span>
			<span class="min-w-0 truncate text-[11px]">{title}</span>
		</div>

		<!-- The measured box. Empty by design: the iframe lives on the frame. -->
		<div
			{@attach (node) => claimSeat(name, node)}
			class="rounded bg-black {big
				? 'min-h-0 flex-1'
				: 'aspect-video min-h-[200px] w-full'}"
		></div>
	</div>

	{#if taken && playerInfo.blocked}
		<!-- The browser refused to start audio with no gesture behind it. Beside
		     the picture, never over it (RMF) — which is why the seat asks and
		     the player does not. -->
		<button
			onclick={() => playerInfo.start()}
			class="btn btn-accent mt-1.5 justify-center py-2 text-xs"
			>Tap to hear the room's music</button
		>
	{:else if !taken}
		<p class="text-muted/70 px-0.5 pt-1 text-[10px]">
			Too little room here — the player is floating instead.
		</p>
	{/if}
</div>
