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
	 * behind the docked slots. It reads the ride and writes nothing back —
	 * rendering never drives the trainer. A world that will not start says so
	 * through `onfail`, and the surface goes back to its slots.
	 */
	import { onMount } from 'svelte';
	import { parseRoute } from '$lib/road/parse';
	import { toRoute } from '$lib/road/route';
	import { mount, type WorldScene } from './scene';
	import { syntheticGpx } from './synthetic';
	import { generate } from './world';
	// ponytail: the dev gallery's blue hour and its synthetic road, until #3085
	// gives the ride its own look and a ride carries its own road (#3057, #3095).
	import { STYLES } from '../../routes/(app)/dev/world/styles';

	let {
		watts,
		ftp,
		paused = false,
		onfail,
	}: {
		watts: number;
		ftp: number;
		/** A shared screen has the focus. */
		paused?: boolean;
		onfail: () => void;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let scene = $state.raw<WorldScene | null>(null);

	onMount(() => {
		// Building holds the main thread for a moment: let the surface paint first.
		const t = setTimeout(() => {
			try {
				const route = toRoute(parseRoute(syntheticGpx()).points);
				scene = mount(canvas!, {
					route,
					world: generate(route),
					style: STYLES.find((s) => s.id === 'bluehour') ?? STYLES[0],
					watts,
					ftp,
					onFail: onfail,
				});
			} catch (err) {
				console.error('world: slot 2 did not start', err);
				onfail();
			}
		}, 40);
		return () => {
			clearTimeout(t);
			scene?.dispose();
			scene = null;
		};
	});

	$effect(() => scene?.setWatts(watts));
	$effect(() => scene?.hold('displaced', paused));
	$effect(() => scene?.hold('shell', shellHidden));
</script>

<canvas
	bind:this={canvas}
	class="block h-full w-full"
	class:invisible={paused}
	aria-hidden="true"
></canvas>
