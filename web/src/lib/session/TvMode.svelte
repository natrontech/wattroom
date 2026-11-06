<script lang="ts">
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import { ZONE_BG, fillPct, zoneOf } from '$lib/components/zones';
	import type { LiveRider } from '$lib/channel/types';
	import type { LiveStats } from '$lib/ride/live-stats.svelte';
	import Skyline from '$lib/ride/Skyline.svelte';
	import type { SkylineView } from '$lib/road/skyline';
	import { TV_LABEL } from '$lib/session/computer-pages';
	import RideRail from '$lib/session/RideRail.svelte';

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
		lthr,
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
		/** Your live numbers: the 3 s power and the rail's details. */
		stats?: LiveStats;
		/** A ride on a road: its horizon is the Skyline (#3641). */
		skyline?: SkylineView | null;
		/** Your LTHR, the graph's heart line's anchor (#4426). */
		lthr?: number;
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
		<!-- The ride rail at three metres (the ride HUD, 2026-11): the same
		     row as the riding screen, then the graph or the road as the ground
		     and the crew beside it, no panels. -->
		<div
			class="flex items-center justify-end gap-[1.5vw] {seated
				? 'pr-[27vw]'
				: ''}"
		>
			{#if placeName || workoutName}<p class="{TV_LABEL} max-w-[24vw] truncate">
					{[placeName, workoutName].filter(Boolean).join(' · ')}
				</p>{/if}
			{@render exit?.()}
		</div>
		<div class={seated ? 'pr-[27vw]' : ''}>
			<RideRail
				watts={stats?.seconds ? stats.power3 : you.watts}
				stale={you.stale || idle}
				target={you.target}
				ftp={you.ftp}
				kg={you.kg}
				{stats}
				{block}
				cadence={you.cadence}
				hr={you.hr}
				{elapsed}
				>{#if idle}<span class="text-muted"
						>No trainer — pair one to see your watts</span
					>{/if}</RideRail
			>
		</div>
		<div class="mt-[2vh] flex min-h-0 flex-1 gap-[2vw]">
			<div class="relative min-h-0 min-w-0 flex-1">
				<div class="absolute inset-0">
					{#if skyline}
						<Skyline tv {...skyline} watts={you.watts} ftp={you.ftp} />
					{:else}
						<IntervalGraph
							{segments}
							{total}
							{elapsed}
							ftp={you.ftp}
							{lthr}
							trace={you.trace}
							tv
						/>
					{/if}
				</div>
			</div>
			<!-- Everyone else, one row per rider. No faces: at 3 m you read names
			     and numbers. Absent riding alone (#1632). -->
			{#if others.length > 0}
				<section
					aria-label="the crew"
					class="flex w-[26vw] shrink-0 flex-col gap-[1.6vh] overflow-hidden"
				>
					{#each others as rider (rider.id)}
						{@const riderZone = zoneOf(rider.watts, rider.ftp)}
						<div class="flex items-center gap-[1.2vw]">
							<span class="w-[8vw] truncate text-[3vh]">{rider.name}</span>
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
	{/if}
</div>
