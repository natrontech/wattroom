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
	 * (#3663); on a session's road, the bunch around you (#3098). Where it
	 * drew everyone sits on the canvas as `data-riders`, a few times a
	 * second, which is how two screens are checked against each other. It
	 * reads the ride and writes nothing back — rendering never
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
	import type { BunchView } from '$lib/channel/bunch-view';
	import { account } from '$lib/account.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { generate } from './world';
	import { readLook } from './look';

	let {
		road,
		metre,
		bunch,
		watts,
		silent = false,
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
		/** Everyone on the road with you, on a session's road. */
		bunch?: () => BunchView | null;
		watts: number;
		/** The trainer is silent past SIGNAL_LOST_MS, the signal the panels read "—" from. */
		silent?: boolean;
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
					bunch,
					steady: () => prefersReducedMotion.current,
					// Your kit is keyed by who you are, solo or in a bunch: the crew sees the one you see.
					youId: account.me?.id,
					// The theme's neon as the canvas resolves it, for the coach's chevron.
					neon: getComputedStyle(canvas!).color,
					// When, at what speed, and where: two screens read a moment apart still compare.
					onTick: (hud) => {
						canvas!.dataset.riders = JSON.stringify({
							t: Date.now(),
							mps: hud.kmh / 3.6,
							riders: hud.riders.map((r) => ({
								id: r.id,
								d: Math.round(r.d * 10) / 10,
								lane: Math.round(r.lane * 100) / 100,
							})),
						});
					},
					onFail: onfail,
				});
				// What a design capture measures on the ride, as /dev/world reports it (World.svelte).
				if (import.meta.env.DEV)
					(window as { __worldProbe?: () => unknown }).__worldProbe = () =>
						scene?.probe();
			} catch (err) {
				console.error('world: slot 2 did not start', err);
				onfail('build-failed');
			}
			// A capture measures the ride's world as /dev/world's (docs/design/DESIGN-CHECK.md).
			if (import.meta.env.DEV && scene)
				(window as { __worldProbe?: () => unknown }).__worldProbe = () =>
					scene?.probe();
		}, 40);
		return () => {
			clearTimeout(t);
			if (import.meta.env.DEV)
				delete (window as { __worldProbe?: unknown }).__worldProbe;
			scene?.dispose();
			scene = null;
			if (import.meta.env.DEV)
				delete (window as { __worldProbe?: () => unknown }).__worldProbe;
		};
	});

	$effect(() => scene?.setWatts(watts));
	$effect(() => scene?.setProgress(progress));
	$effect(() => scene?.setSilent(silent));
	$effect(() => scene?.hold('displaced', paused));
	$effect(() => scene?.hold('shell', shellHidden));
</script>

<canvas
	bind:this={canvas}
	{@attach contextMenu(() => [
		{ label: 'Ride the flat road on this device', onSelect: onflat },
	])}
	class="text-neon block h-full w-full"
	class:invisible={paused}
	aria-hidden="true"
></canvas>
