<script lang="ts">
	import ClimbTable from '$lib/components/ClimbTable.svelte';
	import type { Climb } from '$lib/road/climbs';
	import { kmTicks, profileArea, profilePath } from '$lib/road/draw';
	import type { Road } from '$lib/road/road';
	import { GRADE_FILL } from '$lib/road/skyline';

	/**
	 * A road's heights by distance (#3679): the area filled step by step in
	 * the Skyline's grade ramp, the height line in ink, a class badge over
	 * each classed climb's top, km along the bottom and the top and bottom
	 * heights at the right. The words sit in HTML around the drawing, so the
	 * area can stretch to any width while the type stays its size.
	 */
	let {
		road,
		climbs,
		facts = true,
	}: {
		road: Road;
		climbs: Climb[];
		/** Each climb's facts under the legend; the route page sets its own table. */
		facts?: boolean;
	} = $props();

	const W = 600;
	const H = 140;
	const PAD = 10;
	const runs = $derived(profileArea(road.heights, road.length, W, H, PAD));
	const line = $derived(profilePath(road.heights, W, H, PAD));
	const lo = $derived(Math.min(...road.heights));
	const hi = $derived(Math.max(...road.heights));
	const classed = $derived(climbs.filter((c) => c.cls));
	const km = $derived(road.length / 1000);
	const pct = (m: number) => `${((m / road.length) * 100).toFixed(2)}%`;
	// A climb's top as a share of the drawing's height, for its badge.
	const topY = (c: Climb) => {
		const i = Math.round((c.topM / road.length) * (road.heights.length - 1));
		const e = road.heights[Math.min(road.heights.length - 1, i)];
		return `${(((H - PAD - ((e - lo) / (hi - lo || 1)) * (H - 2 * PAD)) / H) * 100).toFixed(2)}%`;
	};
	const LEGEND = ['0', '3', '6', '9', '12 %+'];
	const SWATCH = [
		'bg-grade-1',
		'bg-grade-2',
		'bg-grade-3',
		'bg-grade-4',
		'bg-grade-5',
	];
</script>

<!-- The chart takes the panel's free height, so beside the shape the two
     panels end together and no band stands empty under the legend. -->
<figure class="panel flex flex-col">
	<div class="mt-6 flex min-h-28 flex-1 gap-3">
		<div class="relative min-w-0 flex-1">
			<svg
				viewBox="0 0 {W} {H}"
				preserveAspectRatio="none"
				class="absolute inset-0 block h-full w-full"
				role="img"
				aria-label="The road's heights by distance, filled by its grade"
			>
				{#each runs as r, i (i)}
					<path d={r.d} class={GRADE_FILL[r.step]} />
				{/each}
				<path
					d={line}
					fill="none"
					class="stroke-ink"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				/>
			</svg>
			{#if classed.length > 0}
				{#each classed as c (c.startM)}
					<span
						class="bg-neon text-on-neon font-display absolute -translate-x-1/2 -translate-y-[calc(100%+4px)] rounded px-2 text-xs leading-5 font-bold"
						style="left: {pct(c.topM)}; top: {topY(c)}"
						aria-hidden="true">{c.cls}</span
					>
				{/each}
			{/if}
		</div>
		<div
			class="text-muted font-display flex flex-col justify-between text-right text-xs tabular-nums"
		>
			<span>{Math.round(hi)} m</span>
			<span>{Math.round(lo)} m</span>
		</div>
	</div>
	<div
		class="text-muted font-display relative mt-1 mr-[3.5rem] h-4 text-xs tabular-nums"
		aria-hidden="true"
	>
		<span class="absolute left-0">0</span>
		{#each kmTicks(road.length).filter((k) => road.length - k * 1000 > road.length * 0.12) as k (k)}
			<span class="absolute -translate-x-1/2" style="left: {pct(k * 1000)}"
				>{k}</span
			>
		{/each}
		<!-- A tick too near the end gives way to the road's length. -->
		<span class="absolute right-0">{km.toFixed(1)} km</span>
	</div>
	<div
		class="text-muted mt-3 flex flex-wrap items-center gap-3 text-xs"
		aria-label="grade legend"
	>
		{#each LEGEND as label, i (label)}
			<span class="flex items-center gap-2">
				<span class="{SWATCH[i]} inline-block h-2.5 w-4 rounded-sm"></span>
				<span class="font-display tabular-nums">{label}</span>
			</span>
		{/each}
	</div>
	{#if facts && classed.length > 0}
		<div class="border-frame mt-3 border-t">
			<ClimbTable {climbs} head={false} />
		</div>
	{/if}
</figure>
