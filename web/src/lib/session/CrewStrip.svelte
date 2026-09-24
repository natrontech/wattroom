<script lang="ts">
	// The crew under the focus slot (ADR-0020): a camera thumb and live watts,
	// w/kg, rpm and bpm for everyone else in the voice channel. A
	// group-training surface that shows only your own numbers is a solo app
	// with a chat window attached.
	//
	// Fixed-width thumbnails scrolling past the edge, never `flex-1` (#410): a
	// tile that grows to fill turns one crewmate into a 16:9 slab and starves
	// the instrument above it.
	//
	// Lifted out of the Training place when the phone got the same strip
	// (#412) — one definition, so the desktop and the phone cannot drift.
	import RidingBars from '$lib/components/RidingBars.svelte';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import { wkg } from '$lib/format';
	import { useChannel } from '$lib/channel/context';
	import { contextMenu } from '$lib/context-menu.svelte';
	import { personMenu } from '$lib/person-menu';
	import { goto } from '$app/navigation';
	import type { LiveRider } from '$lib/channel/types';

	let {
		riders,
		followedId = null,
		onFollow,
		pad = 'px-6',
	}: {
		riders: LiveRider[];
		/** Marked as the one the focus slot is showing — the phone's strip. */
		followedId?: string | null;
		/** Absent where the strip is presence only, as it is on the desktop. */
		onFollow?: (id: string) => void;
		/** The column's own gutter, so the strip scrolls to the screen edge. */
		pad?: string;
	} = $props();

	const channel = useChannel();
	const menuOf = (rider: LiveRider) =>
		personMenu(rider.id, goto, {
			you: rider.you,
			handoff: channel.handOffOf(rider.id, rider.name),
		});
</script>

{#snippet tile(rider: LiveRider, followed: boolean)}
	{@const zone = zoneOf(rider.watts, rider.ftp)}
	<div
		class="bg-surface-raised relative aspect-video overflow-hidden rounded ring-1 {followed
			? 'ring-neon'
			: 'ring-ink/10'}"
	>
		{#if channel.videoOf(rider.id)}
			{#key channel.videoOf(rider.id)}
				<div
					class="absolute inset-0"
					{@attach (node) => channel.attachVideo(rider.id, node)}
				></div>
			{/key}
		{:else}
			<div class="grid h-full w-full place-items-center">
				{#if rider.watts > 0}<RidingBars size={16} />{/if}
			</div>
		{/if}
		<span
			class="from-paper/85 absolute inset-x-0 bottom-0 flex items-baseline gap-1 bg-gradient-to-t to-transparent px-1.5 pt-4 pb-1"
		>
			<span
				class="font-display {ZONE_TEXT[
					zone
				]} text-xl leading-none font-bold tabular-nums"
				data-testid="crew-watts">{rider.watts}</span
			>
			<span class="text-muted text-[9px]">W</span>
			<span
				class="text-muted ml-auto truncate text-[10px]"
				data-testid="crew-name">{rider.name}</span
			>
		</span>
	</div>
	<!-- bpm only when something is reporting it (#2160): a permanent "0 bpm"
	     reads as a broken strap rather than as no strap, which is the call
	     #1057 made for the solo ride and SecondaryRow, TvMode and RiderTile
	     all keep. This strip printed it under every crewmate without one. -->
	<p class="text-muted mt-1 truncate text-[10px] tabular-nums">
		{wkg(rider.watts, rider.kg)} w/kg · {rider.cadence} rpm{#if rider.hr > 0}
			· {rider.hr} bpm{/if}
	</p>
{/snippet}

<div class="flex gap-2 overflow-x-auto {pad}">
	{#each riders as rider (rider.id)}
		{@const followed = rider.id === followedId}
		{#if onFollow}
			<!-- The whole tile is the target: following is a tap on a bike, not a
			     press on a 10 px label (ux.md). -->
			<button
				onclick={() => onFollow(rider.id)}
				{@attach contextMenu(() => menuOf(rider))}
				aria-pressed={followed}
				title="follow {rider.name}"
				class="w-44 shrink-0 text-left"
				data-testid="crew-tile"
			>
				{@render tile(rider, followed)}
			</button>
		{:else}
			<div
				{@attach contextMenu(() => menuOf(rider))}
				class="w-44 shrink-0"
				data-testid="crew-tile"
			>
				{@render tile(rider, followed)}
			</div>
		{/if}
	{/each}
</div>
