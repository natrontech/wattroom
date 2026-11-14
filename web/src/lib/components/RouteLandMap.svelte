<script lang="ts">
	/**
	 * One of WattRoom's designed loops on the Routes page: drawn on its land's
	 * map (LandMap.svelte), as the ride's Map view draws it, zoomed to the loop
	 * with the land round it, one tap showing the whole land. Nobody rides
	 * here, so no dot: the loop, its start and its kilometres. A road that is
	 * on no land's map (the Pass loop) shows `children`, its outline. The map
	 * and its picture load only once a loop needs them, as in the ride.
	 */
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import type { Snippet } from 'svelte';
	import Skeleton from '#lib/components/Skeleton.svelte';
	import { kmTicks } from '#lib/road/draw.ts';
	import type { Road } from '#lib/road/road.ts';
	import type { Route } from '#lib/road/route.ts';
	import { play } from '#lib/sound/cues.ts';

	let { road, children }: { road: Road; children: Snippet } = $props();

	type Placed = {
		road: Road;
		map: import('#lib/world/land-map.ts').LandMapOf;
		line: Route;
		reverse: boolean;
		Map: typeof import('#lib/world/LandMap.svelte').default;
		loopBox: typeof import('#lib/world/land-map.ts').loopBox;
	};
	/** Undefined while the map loads, null for a road on none. */
	let placed = $state.raw<Placed | null | undefined>(undefined);
	$effect(() => {
		const r = road;
		let gone = false;
		placed = undefined;
		void import('#lib/world/land-map.ts').then(
			async ({ onLandMap, loopBox }) => {
				const on = onLandMap(r);
				const Map = on && (await import('#lib/world/LandMap.svelte')).default;
				if (!gone) placed = on && Map ? { road: r, ...on, Map, loopBox } : null;
			},
		);
		return () => {
			gone = true;
		};
	});

	let zoomed = $state(true);
	let w = $state(0);
	let h = $state(0);
	/** The loop with the land round it, as the ride zooms it: none where that draws the land less than 1.25 times as large. */
	const loopView = $derived.by(() => {
		if (!placed || w <= 0 || h <= 0) return undefined;
		const b = placed.map.data.bounds;
		const box = placed.loopBox(placed.line, b, w / h);
		const whole = Math.min(w / (b.east - b.west), h / (b.north - b.south));
		return Math.min(w / box.w, h / box.h) >= 1.25 * whole ? box : undefined;
	});
	/** The road's kilometres, in metres along the map's line. */
	const ticks = $derived(
		placed
			? kmTicks(placed.road.length).map((km) => ({
					km,
					m: placed!.reverse ? placed!.line.length - km * 1000 : km * 1000,
				}))
			: [],
	);
	function zoom() {
		zoomed = !zoomed;
		play('block', zoomed ? {} : { semitones: -5 });
	}
</script>

{#if placed === undefined}
	<Skeleton class="h-[300px] sm:h-[400px]" />
{:else if placed === null}
	{@render children()}
{:else}
	<figure
		class="panel panel-flush relative h-[300px] overflow-hidden sm:h-[400px]"
		bind:clientWidth={w}
		bind:clientHeight={h}
	>
		<placed.Map
			map={placed.map}
			line={placed.line}
			m={placed.reverse ? placed.line.length : 0}
			reverse={placed.reverse}
			you="none"
			{ticks}
			view={loopView && zoomed ? loopView : undefined}
		/>
		{#if loopView}
			<button
				type="button"
				data-testid="map-zoom"
				class="btn btn-secondary btn-xs absolute right-3 bottom-3"
				onclick={zoom}
				>{#if zoomed}<ZoomOut aria-hidden="true" class="size-3.5" />
					Whole map{:else}<ZoomIn aria-hidden="true" class="size-3.5" />
					The loop{/if}</button
			>
		{/if}
	</figure>
{/if}
