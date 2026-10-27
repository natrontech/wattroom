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
	import { onMount, untrack } from 'svelte';
	import { contextMenu } from '$lib/context-menu.svelte';
	import { CAMERA_ASK, PHOTO_ASK, type Failure } from './ride-view';
	import { CAMERA_PRESETS, type CameraPreset } from './cameras';
	import { computerShown } from '$lib/session/computer-shown.svelte';
	import type { Road } from '$lib/road/road';
	import { routeOfRoad } from './road-route';
	import { mount, type WorldScene } from './scene';
	import type { RideMetre } from './sim';
	import type { BunchView } from '$lib/channel/bunch-view';
	import type { RoadMate } from '$lib/channel/road-mates';
	import type { PaintedGate } from '$lib/road/gates';
	import { account } from '$lib/account.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { play } from '$lib/sound/cues';
	import { generate } from './world';
	import { rideLook, worldPaint } from './look';
	import { pictureDue, worldPicture } from './picture.svelte';

	let {
		road,
		metre,
		bunch,
		mates,
		loop = false,
		watts,
		silent = false,
		ftp,
		progress = null,
		paused = false,
		look = 'full',
		countIn = null,
		ghosts,
		gates,
		onfail,
		onflat,
	}: {
		/** The road this ride rides, the way it rides it. */
		road: Road;
		/** Where the ride has you on it, from its first sample. */
		metre: () => RideMetre;
		/** Everyone on the road with you, on a session's road. */
		bunch?: () => BunchView | null;
		/** Channel-mates free-riding this road with you, or the other racers on a race's, each at their own metre (#3117, #3778). */
		mates?: () => readonly RoadMate[];
		/** The session laps the road: it has no finish. */
		loop?: boolean;
		watts: number;
		/** The trainer is silent past SIGNAL_LOST_MS, the signal the panels read "—" from. */
		silent?: boolean;
		ftp: number;
		/** How far through the ride, 0–1, for the light; null when it has no known end (ADR-0072). */
		progress?: number | null;
		/** A shared screen has the focus. */
		paused?: boolean;
		/** The World control's choice (#3214): Steady's camera, Light's budget. */
		look?: 'full' | 'steady' | 'light';
		/** The count-in's seconds left and its length (#3087): the eye flies its reveal to the start arch over it. */
		countIn?: { left: number; total: number } | null;
		/** Your ghosts on a solo ride of your own road, where each is now (#3245); absent, the world has none. */
		ghosts?: () => RideMetre[];
		/** A workout's next blocks on this road (#3101), in the ride's metres. */
		gates?: () => readonly PaintedGate[];
		onfail: (why: Failure) => void;
		/** The rider asked for the flat road on this device. */
		onflat: () => void;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	let scene = $state.raw<WorldScene | null>(null);
	// The frame loop reads the count-in, it is not read by a render.
	let counting: typeof countIn = null;
	$effect(() => {
		counting = countIn;
	});

	// The camera this world shows: the look's own until the rider asks for
	// one (keys 1-4, #3216) or steps on (a remote's or controller's Camera,
	// #4253), through CAMERA_ASK.
	let shown = $state<CameraPreset>(
		untrack(() => (look === 'steady' ? 'steady' : 'chase')),
	);
	$effect(() => {
		scene?.setCamera(shown);
	});
	$effect(() => {
		computerShown.camera = shown;
		// Said on the canvas, as its shot is: a test reads it there.
		if (canvas) canvas.dataset.camera = shown;
		return () => {
			computerShown.camera = null;
		};
	});

	// The ride's picture (#4221): once, by itself, on the first climb or
	// after a while on a flat road, unless the rider took one first (#4253);
	// the last ride's is let go first.
	const PICTURE_POLL_S = 2;
	let taken = false;
	function takePicture() {
		taken = true;
		void scene?.snap().then((shot) => {
			if (!shot) return;
			worldPicture.keep(shot);
			// Said on the canvas, as its shot is: a capture waits for it.
			if (canvas) canvas.dataset.picture = 'taken';
		});
	}
	onMount(() => {
		const ask = (event: Event) => {
			const preset = (event as CustomEvent<CameraPreset | undefined>).detail;
			shown =
				preset ??
				CAMERA_PRESETS[
					(CAMERA_PRESETS.indexOf(shown) + 1) % CAMERA_PRESETS.length
				];
			event.preventDefault();
		};
		const photo = (event: Event) => {
			if (!scene) return;
			takePicture();
			event.preventDefault();
		};
		window.addEventListener(CAMERA_ASK, ask);
		window.addEventListener(PHOTO_ASK, photo);
		worldPicture.clear();
		let ridden = 0;
		const picture = setInterval(() => {
			if (taken || !scene || counting || paused) return;
			const at = metre();
			if (at.mps > 0.5) ridden += PICTURE_POLL_S;
			if (pictureDue(road, at.m, ridden)) takePicture();
		}, PICTURE_POLL_S * 1000);
		// Building holds the main thread for a moment: let the surface paint first.
		const t = setTimeout(() => {
			try {
				const route = routeOfRoad(road);
				const paint = worldPaint(canvas!.parentElement ?? document.body);
				scene = mount(canvas!, {
					route,
					world: generate(route),
					style: rideLook(paint),
					watts,
					ftp,
					metre,
					bunch,
					mates,
					loop,
					countIn: () => counting,
					ghosts,
					gates,
					camera: shown,
					light: look === 'light',
					steady: () => prefersReducedMotion.current || look === 'steady',
					onCue: play,
					// Your kit is keyed by who you are, solo or in a bunch: the crew sees the one you see.
					youId: account.me?.id,
					// The theme's neon as the world resolves it, for the coach's chevron.
					neon: paint('color-neon'),
					// When, at what speed, and where: two screens read a moment apart still compare.
					onTick: (hud) => {
						if (hud.shot) canvas!.dataset.shot = hud.shot;
						else delete canvas!.dataset.shot;
						canvas!.dataset.riders = JSON.stringify({
							t: Date.now(),
							mps: hud.kmh / 3.6,
							riders: hud.riders.map((r) => ({
								id: r.id,
								d: Math.round(r.d * 10) / 10,
								v: Math.round(r.v * 10) / 10,
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
			window.removeEventListener(CAMERA_ASK, ask);
			window.removeEventListener(PHOTO_ASK, photo);
			clearTimeout(t);
			clearInterval(picture);
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
	class="block h-full w-full"
	class:invisible={paused}
	aria-hidden="true"
></canvas>
