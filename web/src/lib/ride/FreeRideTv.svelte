<script lang="ts">
	/**
	 * A free ride on the TV (#1632, #3894): the frame a workout ride has,
	 * handed a roster of one with no block and no segments — the 3 s power,
	 * the clock and the road line, no block and no NEXT. One frame for the
	 * road ride at /ride and a voice channel's free ride (ADR-0046).
	 */
	import type { LiveRider } from '$lib/channel/types';
	import type { FreeRide } from '$lib/ride/free-ride.svelte';
	import TvOverlay from '$lib/session/TvOverlay.svelte';
	import { skylineOf } from '$lib/workout/road-workout';

	let {
		free,
		rider,
		ftp,
		placeName,
		onExit,
	}: {
		free: FreeRide;
		rider: LiveRider;
		ftp: number;
		placeName: string;
		onExit: () => void;
	} = $props();
</script>

<TvOverlay
	stats={free.live}
	skyline={free.road
		? skylineOf(
				{
					road: free.road.profile,
					along: free.road.m,
					mps: free.road.virtualMps,
					startM: 0,
				},
				[],
				ftp,
			)
		: null}
	riders={[rider]}
	segments={[]}
	total={0}
	elapsed={free.seconds}
	block={null}
	{placeName}
	live
	{onExit}
/>
