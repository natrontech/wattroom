<script lang="ts">
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import IntervalStrip from '$lib/room/IntervalStrip.svelte';
	import TargetWidget from '$lib/room/TargetWidget.svelte';
	import IntervalGraph from '$lib/components/IntervalGraph.svelte';
	import {
		ZONE_BG,
		ZONE_TEXT,
		type MockRider,
		fillPct,
		formatClock,
		zoneOf,
	} from '$lib/room/mockcompat';

	let {
		riders,
		segments,
		total,
		elapsed,
		block,
		roomName = '',
		workoutName = '',
		live = true,
		code = '',
	}: {
		riders: MockRider[];
		segments: import('$lib/workout/types').Segment[];
		total: number;
		elapsed: number;
		block: import('$lib/room/view').Block | null;
		roomName?: string;
		workoutName?: string;
		/** A session is running — the HUD only exists then (#125). */
		live?: boolean;
		/** Join code for the lounge screen: TVs are where the code is most useful. */
		code?: string;
	} = $props();

	const you = $derived(riders.find((r) => r.you) ?? riders[0]);
	const others = $derived(riders.filter((r) => !r.you));
	const zone = $derived(zoneOf(you.watts, you.ftp));
</script>

<!--
	TV mode is a different information density, not a rearrangement: no controls, no
	chat, nothing you would need to walk over and click. Everything sized in vh so it
	holds at 3 m on any panel.
-->
<div class="bg-surface flex h-full flex-col px-[3vw] py-[3vh]">
	{#if !live || !you}
		<!-- Idle lounge: no HUD of glowing zeros (glow marks LIVE data,
		     ADR-0005) — the TV shows who is here and how to join. -->
		<div class="flex flex-1 flex-col items-center justify-center text-center">
			<h1 class="font-display text-[6vh] leading-none font-bold">
				{roomName}
			</h1>
			<p class="text-muted mt-[2vh] text-[2.4vh]">
				{riders.length
					? riders.map((rider) => rider.name).join(' · ')
					: 'Nobody riding yet'}
			</p>
			{#if code}
				<p class="text-muted mt-[6vh] text-[1.8vh] tracking-[0.2em] uppercase">
					join code
				</p>
				<p
					class="font-display mt-[1vh] text-[7vh] leading-none font-bold tracking-[0.3em] tabular-nums"
				>
					{code}
				</p>
			{/if}
			<p class="text-muted mt-[6vh] text-[2vh]">
				Waiting for the coach to start a session.
			</p>
		</div>
	{:else}
		<header class="flex items-baseline gap-[2vw]">
			<h1 class="font-display text-[3.4vh] leading-none font-bold">
				{roomName}
			</h1>
			<span class="text-muted text-[2.2vh]">{workoutName}</span>
			<span
				class="font-display ml-auto text-[4.5vh] leading-none font-bold tabular-nums"
				>{formatClock(elapsed)}</span
			>
		</header>

		<div class="mt-[3vh] flex flex-1 gap-[3vw]">
			<!-- Yours: the number you read from across the room, plus how far off you are. -->
			<section class="flex flex-1 flex-col justify-center">
				<TargetWidget {you} variant="delta" />
				<div class="mt-[2.5vh]">
					<IntervalStrip
						{block}
						bias={1}
						cadence={you.cadence}
						hr={you.hr}
						big
					/>
				</div>
				<div class="mt-[2vh] flex items-baseline gap-[2.5vw] text-[2.4vh]">
					<span class="text-muted"
						>target <span class="text-ink">{you.target} W</span></span
					>
					<span class="text-ink"
						>{you.cadence}
						<span class="text-muted text-[1.6vh]">rpm</span></span
					>
					<span class="text-ink"
						>{you.hr} <span class="text-muted text-[1.6vh]">bpm</span></span
					>
					<span class="font-display font-bold {ZONE_TEXT[zone]}">Z{zone}</span>
				</div>
			</section>

			<!-- The room, one row per rider. No faces: at 3 m you read names and numbers. -->
			<section class="flex w-[34vw] flex-col justify-center gap-[1.6vh]">
				{#each others as rider (rider.name)}
					{@const riderZone = zoneOf(rider.watts, rider.ftp)}
					<div class="flex items-center gap-[1.2vw]">
						<span class="w-[7vw] truncate text-[2.6vh]">{rider.name}</span>
						<ProgressBar
							pct={fillPct(rider.watts, rider.ftp)}
							h="h-[1.6vh]"
							fill="{ZONE_BG[
								riderZone
							]} transition-[width] duration-500 ease-out"
							class="flex-1"
						/>
						<span
							class="font-display w-[6vw] text-right text-[3.2vh] font-bold tabular-nums"
							>{rider.watts}</span
						>
					</div>
				{/each}
			</section>
		</div>

		<div class="flex items-end gap-[2vw]">
			<div class="min-w-0 flex-1 overflow-hidden rounded-lg">
				<IntervalGraph
					{segments}
					{total}
					{elapsed}
					ftp={you.ftp}
					trace={you.trace}
				/>
			</div>
		</div>
	{/if}
</div>
