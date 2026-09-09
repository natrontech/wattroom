<script lang="ts">
	import { segmentsDuration } from '$lib/workout/engine';
	import type { Segment } from '$lib/workout/types';
	import IntervalGraph from './IntervalGraph.svelte';
	import ZoneLegend from './ZoneLegend.svelte';
	import { plannedZoneSeconds } from './zones';

	/**
	 * How a planned workout is drawn wherever nobody is riding it yet: its shape,
	 * and the zones that name the colours in it. One picture for the shelf, for a
	 * rider's own workouts and for the room's next session — a stacked bar said
	 * how long each zone lasts, never what the workout looks like (#1525).
	 */
	let {
		segments,
		ftp,
		compact = false,
		names = true,
		legendClass = '',
	}: {
		segments: Segment[];
		ftp: number;
		compact?: boolean;
		names?: boolean;
		/** Padding for the text row: the graph itself is often bled to a card edge. */
		legendClass?: string;
	} = $props();

	const total = $derived(segmentsDuration(segments));
</script>

<div class={legendClass}>
	<ZoneLegend seconds={plannedZoneSeconds(segments, ftp)} {names} />
</div>
<IntervalGraph {segments} {total} elapsed={0} {ftp} trace={[]} {compact} />
