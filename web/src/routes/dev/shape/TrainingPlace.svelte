<script lang="ts">
	// The 3 m surface, split out of RoomPlaces when that file crossed the
	// 500-line ceiling (code-quality.md).
	//
	// A FOCUS SLOT, not a fixed layout. Normally the focus is your own
	// instrument. When someone shares a screen, that takes the focus and the
	// instrument collapses to a bar underneath — never on top: RMF forbids
	// anything overlaid on a player. That is WATTROOM.md's old "media-focus
	// layout", except the room enters it when there is media instead of making
	// the rider pick it from a menu.
	//
	// The jukebox is deliberately NOT what fills this slot — see JukeboxDock:
	// one player instance, frame-level, because RMF also forbids auto-advance
	// while the player is offscreen. Moving an iframe between parents remounts
	// it and stops playback, so there is exactly one and it does not travel.
	import FaultBanner from '$lib/room/FaultBanner.svelte';
	import GameFocus from './GameFocus.svelte';
	import Instrument from './Instrument.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import RidingBars from './RidingBars.svelte';
	import SecondaryRow from './SecondaryRow.svelte';
	import SprintFocus from './SprintFocus.svelte';
	import { formatClock, wkg } from '$lib/format';
	import { ZONE_TEXT, zoneOf } from '$lib/components/zones';
	import type { Segment } from '$lib/workout/types';
	import type { Block, RoomRider } from '$lib/room/view';

	let {
		riders,
		you,
		segments,
		total,
		elapsed,
		block,
		bias,
		media = false,
		fault = false,
		sprint,
		game = false,
	}: {
		riders: RoomRider[];
		you: RoomRider;
		segments: Segment[];
		total: number;
		elapsed: number;
		block: Block | null;
		bias: number;
		/** Someone is sharing a screen — the player takes the focus. */
		media?: boolean;
		/** Trainer dropped mid-interval. */
		fault?: boolean;
		/** A sprint window owns the focus while it runs. */
		sprint?: 'klaxon' | 'live' | 'podium';
		/** The session is a game mode rather than a workout. */
		game?: boolean;
	} = $props();

	// The focus slot's priority order (ADR-0020): a sprint takes the screen and
	// gives it back, a game replaces the workout, a shared screen replaces
	// both, and your instrument is what returns.
	const focus = $derived(
		sprint ? 'sprint' : game ? 'game' : media ? 'media' : 'you',
	);
</script>

<div class="grid h-full min-h-0 grid-rows-[auto_1fr_auto_auto] overflow-hidden">
	<header class="flex items-end gap-6 px-6 pt-5 pb-4">
		<div class="min-w-0">
			<p class="eyebrow">block {block?.index ?? 1} of {block?.count ?? 6}</p>
			<h2 class="font-display truncate text-3xl leading-none font-bold">
				{block?.label ?? 'Warm-up'}
			</h2>
		</div>
		<div class="shrink-0">
			<p class="eyebrow">left in block</p>
			<p class="font-display text-3xl leading-none font-bold tabular-nums">
				{formatClock(block?.secondsLeft ?? 0)}
			</p>
		</div>
		{#if block?.next}
			<p class="text-muted min-w-0 truncate text-xs">
				next · {block.next.label}
				{block.next.watts} W for {Math.round(block.next.seconds / 60)} min
			</p>
		{/if}
		<p class="text-muted ml-auto shrink-0 text-sm tabular-nums">
			{formatClock(elapsed)}
			<span class="text-muted/50">/ {formatClock(total)}</span>
		</p>
	</header>

	{#if fault}
		<!-- errors.md: ride-critical faults are PERSISTENT dashboard status, never
		     a toast — the rider is on a bike, sweating, three metres away, and a
		     four-second toast is a message they will not see. -->
		<div class="mb-3 px-6">
			<FaultBanner
				fault={{ kind: 'trainer', state: 'reconnecting' }}
				bufferedSeconds={8}
				onRecover={() => {}}
			/>
		</div>
	{/if}

	{#if focus === 'sprint'}
		<section class="min-h-0 px-6">
			<SprintFocus {riders} phase={sprint!} />
		</section>
	{:else if focus === 'game'}
		<section class="min-h-0 px-6"><GameFocus {riders} /></section>
	{:else if focus === 'media'}
		<section class="grid min-h-0 place-items-center px-6">
			<div
				class="ring-neon/30 relative aspect-video max-h-full w-full overflow-hidden rounded-lg ring-1"
			>
				<div
					class="h-full w-full"
					style="background: radial-gradient(120% 90% at 30% 20%, oklch(0.42 0.16 300), oklch(0.14 0.05 300))"
				></div>
			</div>
		</section>
	{:else}
		<section class="grid min-h-0 content-center px-6">
			<Instrument {you} />
		</section>
	{/if}

	{#if focus === 'sprint' || focus === 'game'}
		<!-- Both carry their own standings; the crew strip below would be a
		     third list of the same six people. -->
		<div></div>
		<div></div>
	{:else}
		<div class="mt-4 flex items-center gap-6 px-6">
			{#if media}
				<div class="min-w-0 flex-1"><Instrument {you} compact /></div>
			{/if}
			<SecondaryRow {you} {bias} small={media} />
		</div>

		<!-- The crew. A group-training surface that shows only your own numbers is
	     a solo app with a chat window attached. -->
		<div class="mt-4">
			<div class="flex gap-2 px-6">
				{#each riders.filter((r) => !r.you) as rider (rider.id)}
					{@const zone = zoneOf(rider.watts, rider.ftp)}
					<div class="min-w-0 flex-1">
						<div
							class="ring-ink/10 relative aspect-video overflow-hidden rounded ring-1"
						>
							{#if rider.cameraOn}
								<div
									class="h-full w-full"
									style="background: radial-gradient(120% 100% at 40% 20%, oklch(0.45 0.13 {rider.hue}), oklch(0.16 0.05 {rider.hue}))"
								></div>
							{:else}
								<div
									class="bg-surface-raised grid h-full w-full place-items-center"
								>
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
									>{rider.watts}</span
								>
								<span class="text-muted text-[9px]">W</span>
								<span class="text-muted ml-auto truncate text-[10px]"
									>{rider.name}</span
								>
							</span>
						</div>
						<p class="text-muted mt-1 truncate text-[10px] tabular-nums">
							{wkg(rider.watts, rider.kg)} w/kg · {rider.cadence} rpm · {rider.hr}
							bpm
						</p>
					</div>
				{/each}
			</div>

			{#if !media}
				<!-- The horizon: the session is the ground the numbers stand on, not
			     another card. It gives way to the player when media has the focus
			     — two grounds is one too many. -->
				<div class="mt-3 h-28">
					<IntervalGraph
						{segments}
						{total}
						{elapsed}
						ftp={you.ftp}
						trace={you.trace}
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>
