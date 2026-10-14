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
		exit,
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
		/** The way out, in the top row beside the title and clock (#3677). */
		exit?: import('svelte').Snippet;
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
<div class="bg-surface flex h-full flex-col px-[3vw] py-[3vh]">
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
		<header class="flex items-center gap-[2vw] {seated ? 'pr-[27vw]' : ''}">
			<h1 class="font-display text-[3.4vh] leading-none font-bold">
				{placeName}
			</h1>
			<span class="text-muted text-[3vh]">{workoutName}</span>
			<span
				class="font-display ml-auto text-[5vh] leading-none font-bold tabular-nums"
				>{formatClock(elapsed)}</span
			>
			{@render exit?.()}
		</header>

		<!-- The riding surface's panels at three metres (ADR-0046, #3677): the
		     bike computer — page control, head, fields — beside slot 1 and the
		     roster, one column each, as tall as the tallest; the graph takes
		     the rest along the bottom. -->
		<div
			class="mt-[2vh] grid auto-cols-fr grid-flow-col gap-[1.5vw] {seated
				? 'pr-[27vw]'
				: ''}"
		>
			<!-- Slot 3 at three metres (#3088): the same pages, turned by the
			     same keys. -->
			<section class="ride-panel min-w-0">
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
				/>
				{#if idle}
					<p class="text-muted px-[1.5vw] pb-[1.5vh] text-[3vh]">
						No trainer — pair one to see your watts
					</p>
				{/if}
			</section>
			{#if block}
				<IntervalStrip {block} bias={1} cadence={you.cadence} hr={you.hr} big />
			{/if}

			<!-- Everyone else, one row per rider. No faces: at 3 m you read names and
			     numbers. Absent riding alone (#1632): the same TV serves a solo
			     ride, and an empty third of the screen is not a roster. -->
			{#if others.length > 0}
				<section
					class="ride-panel flex min-w-0 flex-col gap-[1.6vh] px-[1.5vw] py-[1.5vh]"
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

		<div class="ride-panel mt-[1.5vh] min-h-[14vh] flex-1 overflow-hidden">
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
	{/if}
</div>
