<script module lang="ts">
	import { onShellVisibility } from '$lib/desktop';

	// The desktop shell put its window away (a close to the tray): nobody is
	// looking, so the world holds. One listener for the page, however many
	// rides mount a world.
	let shellHidden = $state(false);
	onShellVisibility((visible) => (shellHidden = !visible));
</script>

<script lang="ts">
	/**
	 * The world in slot 2 (#3031, ADR-0066): the rider's ride on a road, drawn
	 * behind the docked slots, built from the road this ride carries, with
	 * your figure at the ride's own metre and nobody on it who is not there
	 * (#3663). It reads the ride and writes nothing back — rendering never
	 * drives the trainer. A world that will not start, or
	 * stops, says why through `onfail`, and rideView() takes it from there
	 * (#3080). A right-click on it offers the flat road.
	 */
	import { onMount } from 'svelte';
	import { contextMenu } from '$lib/context-menu.svelte';
	import type { Failure } from './ride-view';
	import type { Road } from '$lib/road/road';
	import { routeOfRoad } from './road-route';
	import { mount, type WorldScene } from './scene';
	import type { RideMetre } from './sim';
	import { generate } from './world';
	import { readLook } from './look';

	let {
		road,
		metre,
		watts,
		ftp,
		progress = null,
		paused = false,
		onfail,
		onflat,
	}: {
		/** The road this ride rides, the way it rides it. */
		road: Road;
		/** Where the ride has you on it, from its first sample. */
		metre: () => RideMetre;
		watts: number;
		ftp: number;
		/** How far through the ride, 0–1, for the light; null when it has no known end (ADR-0072). */
		progress?: number | null;
		/** A shared screen has the focus. */
		paused?: boolean;
		onfail: (why: Failure) => void;
		/** The rider asked for the flat road on this device. */
		onflat: () => void;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let scene = $state.raw<WorldScene | null>(null);

	onMount(() => {
		// Building holds the main thread for a moment: let the surface paint first.
		const t = setTimeout(() => {
			try {
				const route = routeOfRoad(road);
				scene = mount(canvas!, {
					route,
					world: generate(route),
					style: readLook(canvas!.parentElement ?? document.body),
					watts,
					ftp,
					metre,
					onFail: onfail,
				});
			} catch (err) {
				console.error('world: slot 2 did not start', err);
				onfail('build-failed');
			}
		}, 40);
		return () => {
			clearTimeout(t);
			scene?.dispose();
			scene = null;
		};
	});

	$effect(() => scene?.setWatts(watts));
	$effect(() => scene?.setProgress(progress));
	$effect(() => scene?.hold('displaced', paused));
	$effect(() => scene?.hold('shell', shellHidden));
</script>

<canvas
	bind:this={canvas}
	{@attach contextMenu(() => [
		{ label: 'Ride the flat road on this device', onSelect: onflat },
	])}
	class="block h-full w-full"
	class:invisible={paused}
	aria-hidden="true"
></canvas>
