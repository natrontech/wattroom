<script lang="ts">
	import IntervalStrip from './IntervalStrip.svelte';
	import TargetWidget from './TargetWidget.svelte';
	import IntervalGraph from './IntervalGraph.svelte';
	import {
		ZONE_BG,
		ZONE_TEXT,
		type MockRider,
		fillPct,
		formatClock,
		ROOM_NAME,
		workout,
		zoneOf,
	} from './mockRoom.svelte';

	let {
		riders,
		segments,
		total,
		elapsed,
		block,
	}: {
		riders: MockRider[];
		segments: import('$lib/workout/types').Segment[];
		total: number;
		elapsed: number;
		block: import('./mockRoom.svelte').Block | null;
	} = $props();

	const you = $derived(riders.find((r) => r.you)!);
	const others = $derived(riders.filter((r) => !r.you));
	const zone = $derived(zoneOf(you.watts, you.ftp));
</script>

<!--
	TV mode is a different information density, not a rearrangement: no controls, no
	chat, nothing you would need to walk over and click. Everything sized in vh so it
	holds at 3 m on any panel.
-->
<div class="bg-surface flex h-full flex-col px-[3vw] py-[3vh]">
	<header class="flex items-baseline gap-[2vw]">
		<h1 class="font-display text-[3.4vh] leading-none font-bold">
			{ROOM_NAME}
		</h1>
		<span class="text-muted text-[2.2vh]">{workout.name}</span>
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
				<IntervalStrip {block} bias={1} big />
			</div>
			<div class="mt-[2vh] flex items-baseline gap-[2.5vw] text-[2.4vh]">
				<span class="text-muted"
					>target <span class="text-white">{you.target} W</span></span
				>
				<span class="text-muted"
					>{you.cadence} <span class="text-[1.6vh]">rpm</span></span
				>
				<span class="text-muted"
					>{you.hr} <span class="text-[1.6vh]">bpm</span></span
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
					<div
						class="bg-surface-raised h-[1.6vh] flex-1 overflow-hidden rounded-full"
					>
						<div
							class="h-full transition-[width] duration-500 ease-out {ZONE_BG[
								riderZone
							]}"
							style="width: {fillPct(rider.watts, rider.ftp)}%"
						></div>
					</div>
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
		<!-- RMF holds in TV mode too: the player stays on screen while media plays. -->
		<div
			class="text-muted grid h-[200px] w-[280px] shrink-0 place-items-center rounded-lg text-center text-xs ring-1 ring-white/10"
			style="background: linear-gradient(150deg, #1a0736, #05010f)"
		>
			YouTube player tile<br />≥200×200, never overlaid
		</div>
	</div>
</div>
