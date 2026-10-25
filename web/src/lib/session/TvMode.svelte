<script lang="ts">
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import IntervalStrip from '$lib/session/IntervalStrip.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { ZONE_BG, fillPct, zoneOf } from '$lib/components/zones';
	import { formatClock } from '$lib/format';
	import type { LiveRider } from '$lib/channel/types';
	import type { LiveStats } from '$lib/ride/live-stats.svelte';
	import BikeComputer from '$lib/session/BikeComputer.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import type { SkylineView } from '$lib/road/skyline';
	import type { ClimbView } from '$lib/ride/climb-view';
	import type { MapView } from '$lib/ride/map-view';
	import { TV_LABEL } from '$lib/session/computer-pages';

	let {
		riders,
		idle = false,
		segments,
		total,
		elapsed,
		block,
		placeName = '',
		workoutName = '',
		live = true,
		code = '',
		stats,
		skyline = null,
		climb = null,
		map = null,
		exit,
		status,
		seated = false,
	}: {
		riders: LiveRider[];
		/** Your instrument has nothing paired to read (#2941). */
		idle?: boolean;
		segments: import('$lib/workout/types').Segment[];
		total: number;
		elapsed: number;
		block: import('$lib/workout/block').Block | null;
		placeName?: string;
		workoutName?: string;
		/** A session is running — the HUD only exists then (#125). */
		live?: boolean;
		/** The crew's join code for the lounge screen (#1236): TVs are where a
		 * code is most useful, and the crew's is the only one there is. */
		code?: string;
		/** Your live numbers, for the bike computer's POWER page (#3088). */
		stats?: LiveStats;
		/** A ride on a road: its horizon is the Skyline (#3641). */
		skyline?: SkylineView | null;
		/** The climb card, for the bike computer (#3645). */
		climb?: ClimbView | null;
		/** The road from above, for its MAP page (#3645). */
		map?: MapView | null;
		/** The way out, in the work panel's top row beside the eyebrow (#3677). */
		exit?: import('svelte').Snippet;
		/** Ride-critical status: one persistent row above the panels (G3). */
		status?: import('svelte').Snippet;
		/** The jukebox sits in the top-right seat: the top rows end short of it. */
		seated?: boolean;
	} = $props();

	const you = $derived(riders.find((r) => r.you) ?? riders[0]);
	const others = $derived(riders.filter((r) => !r.you));
</script>

<!--
	TV mode is a different information density, not a rearrangement: no controls, no
	chat, nothing you would need to walk over and click. Everything sized in vh so it
	holds at 3 m on any panel.
-->
{#snippet head()}
	<!-- v2-erg's eyebrow, inside the work panel: the place, the workout where
	     slot 1 does not already name it (D17), and the way out beside them. -->
	<div class="flex items-center gap-[1.5vw]">
		<h1 class="{TV_LABEL} truncate">
			{placeName}{workoutName && workoutName !== block?.label
				? ` · ${workoutName}`
				: ''}
		</h1>
		{#if !block}
			<span class="num ml-auto text-[5vh] leading-none font-bold"
				>{formatClock(elapsed)}</span
			>
		{/if}
		<span class="shrink-0 {block ? 'ml-auto' : ''}">{@render exit?.()}</span>
	</div>
{/snippet}

<div class="bg-surface flex h-full flex-col p-[3vh]">
	{#if status}
		<div class="shrink-0 pb-[1.5vh] {seated ? 'pr-[27vw]' : ''}">
			{@render status()}
		</div>
	{/if}
	{#if !live || !you}
		<div class="flex justify-end {seated ? 'pr-[27vw]' : ''}">
			{@render exit?.()}
		</div>
		<!-- Idle lounge: no HUD of glowing zeros (glow marks LIVE data,
		     ADR-0005) — the TV shows who is here and how to join. -->
		<div class="flex flex-1 flex-col items-center justify-center text-center">
			<h1 class="font-display text-[6vh] leading-none font-bold">
				{placeName}
			</h1>
			<p class="text-muted mt-[2vh] text-[3vh]">
				{riders.length
					? riders.map((rider) => rider.name).join(' · ')
					: 'Nobody riding yet'}
			</p>
			{#if code}
				<p class="text-muted mt-[6vh] text-[3vh] tracking-[0.2em] uppercase">
					crew code
				</p>
				<p
					class="font-display mt-[1vh] text-[7vh] leading-none font-bold tracking-[0.3em] tabular-nums"
				>
					{code}
				</p>
			{/if}
			<p class="text-muted mt-[6vh] text-[3vh]">
				No session yet — start one from the laptop.
			</p>
		</div>
	{:else}
		<!-- The riding surface's panels at three metres (ADR-0046, #3677), one
		     row as tall as its content: each panel's numbers take the height
		     first, up to their caps, and the graph's band grows by what they
		     can't use. A row taller than the screen shrinks the numbers, never
		     the graph. -->
		<div
			class="grid min-h-0 flex-1 grid-rows-[minmax(0,auto)_minmax(12.5vh,1fr)]"
		>
			<div
				class="grid min-h-0 grid-rows-[minmax(0,1fr)] gap-[1.5vh] {block &&
				others.length
					? 'grid-cols-[4fr_3fr_3fr]'
					: block
						? 'grid-cols-2'
						: others.length
							? 'grid-cols-[3fr_2fr]'
							: 'grid-cols-1'} {seated ? 'pr-[27vw]' : ''}"
			>
				<!-- Slot 3 at three metres (#3088): the same pages, turned by the
				     same keys. -->
				<section
					class="ride-panel @container flex max-h-full min-h-0 min-w-0 flex-col overflow-hidden"
				>
					{#if !block}
						<div class="px-[1.5vw] pt-[1.5vh]">{@render head()}</div>
					{/if}
					<BikeComputer
						tv
						docked
						cadence={you.cadence}
						hr={you.hr}
						watts={you.watts}
						kg={you.kg}
						ftp={you.ftp}
						stale={you.stale || idle}
						target={you.target > 0 ? you.target : undefined}
						{stats}
						{climb}
						{map}
					/>
					{#if idle}
						<p class="text-muted px-[1.5vw] pb-[1.5vh] text-[3vh]">
							No trainer — pair one to see your watts
						</p>
					{/if}
				</section>
				{#if block}
					<IntervalStrip
						{block}
						bias={1}
						cadence={you.cadence}
						hr={you.hr}
						{elapsed}
						{total}
						big
						{head}
					/>
				{/if}

				<!-- Everyone else, one row per rider. No faces: at 3 m you read names and
				     numbers. Absent riding alone (#1632): the same TV serves a solo
				     ride, and an empty third of the screen is not a roster. -->
				{#if others.length > 0}
					<section
						class="ride-panel flex max-h-full min-w-0 flex-col gap-[1.6vh] overflow-hidden px-[1.5vw] py-[1.5vh]"
					>
						{#each others as rider (rider.id)}
							{@const riderZone = zoneOf(rider.watts, rider.ftp)}
							<div class="flex items-center gap-[1.2vw]">
								<span class="w-[7vw] truncate text-[3vh]">{rider.name}</span>
								<ProgressBar
									pct={fillPct(rider.watts, rider.ftp)}
									h="h-[1.6vh]"
									fill="{ZONE_BG[
										riderZone
									]} transition-[width] duration-(--dur-live) ease-live"
									class="flex-1"
								/>
								<span
									class="font-display w-[7vw] text-right text-[5vh] font-bold tabular-nums"
									>{rider.watts}</span
								>
							</div>
						{/each}
					</section>
				{/if}
			</div>

			<div class="ride-panel mt-[1.5vh] min-h-0 overflow-hidden">
				{#if skyline}
					<div class="h-full"><Skyline tv {...skyline} /></div>
				{:else}
					<IntervalGraph
						{segments}
						{total}
						{elapsed}
						ftp={you.ftp}
						trace={you.trace}
						tv
					/>
				{/if}
			</div>
		</div>
	{/if}
</div>
