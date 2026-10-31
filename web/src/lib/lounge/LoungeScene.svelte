<script lang="ts">
	// The lounge (ADR-0094): the picture an idle voice channel shows, and
	// house radio while its deck is empty. The page decides when it shows;
	// this draws it, keeps its clock, and plays the station.
	import { untrack } from 'svelte';
	import Radio from '@lucide/svelte/icons/radio';
	import { useChannel } from '$lib/channel/context';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { listening } from '$lib/channel/listening.svelte';
	import { playheadAt } from '$lib/channel/playhead';
	import { serverNow } from '$lib/server-clock';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { onDuck } from '$lib/sound/duck';
	import { prefersReducedMotion } from '$lib/motion';
	import { createHouseRadio, type HouseRadio } from '$lib/lounge/house-radio';
	import { sceneLoop } from '$lib/lounge/scene-loop';
	import { KEY_NAMES, drumsIn, positionAt } from '$lib/lounge/station';
	import {
		nextWeather,
		radioWanted,
		setRadioWanted,
		weatherOf,
	} from '$lib/lounge/state';
	import { riderOf, seatedOf } from '$lib/lounge/figures';
	import { skyAt } from '$lib/lounge/palette';
	import {
		SCENE_H,
		SCENE_W,
		drawScene,
		seatAt,
		spotAt,
		type Heart,
		type SceneInput,
	} from '$lib/lounge/scene';

	/** At most three times the scene's own pixels, and never more than half the window's height. */
	const MAX_SCALE = 3;

	const channel = useChannel();
	const live = $derived(channelConnection.current?.live);
	const deck = $derived(live?.tick?.jukebox);
	const lounge = $derived(live?.tick?.lounge);
	const station = $derived(channel.address.crew);

	let wanted = $state(radioWanted());
	const deckIdle = $derived(!deck?.current);
	const radioOn = $derived(
		wanted && deckIdle && !listening.out && !mixer.muted && mixer.music > 0,
	);
	// One station per crew: a new crew is a new context, closed with the old.
	let radio = $state.raw<HouseRadio | null>(null);
	$effect(() => {
		const made = createHouseRadio(station, serverNow);
		radio = made;
		return () => made.close();
	});

	let width = $state(0);
	const scale = $derived(
		Math.max(
			1,
			Math.min(
				MAX_SCALE,
				Math.floor(width / SCENE_W),
				Math.floor(
					(typeof window === 'undefined' ? 720 : window.innerHeight) /
						2 /
						SCENE_H,
				),
			),
		),
	);

	let canvas = $state<HTMLCanvasElement | null>(null);
	let hearts = $state<Heart[]>([]);
	let catAwakeUntil = $state(0);
	let clock = 0;
	let crank = 0.9;
	let nowPlaying = $state('');
	/** The theme's live-data hue, read once the canvas is in the page. */
	let watt = '#ff3d8b';

	function music(): Pick<SceneInput, 'playing' | 'beat' | 'pulsing'> {
		const current = deck?.current;
		if (current) {
			const bpm = current.bpm ?? 0;
			const at = playheadAt(deck!, serverNow());
			return {
				playing: deck!.playing,
				beat: (at * bpm) / 60,
				pulsing: deck!.playing && bpm > 0,
			};
		}
		const p = positionAt(station, serverNow() / 1000);
		return { playing: radioOn, beat: p.beat, pulsing: drumsIn(p.section) };
	}

	function frame(g: CanvasRenderingContext2D, dt: number, still: boolean) {
		if (!still) clock += dt;
		const riders = channel.riders;
		const onBike = riders.find((r) => r.id === riderOf(riders, 0)?.id);
		if (onBike && !still)
			crank += ((onBike.cadence || 80) / 60) * Math.PI * 2 * dt;
		const rider = riderOf(riders, crank);
		const now = new Date();
		drawScene(g, {
			t: clock,
			still,
			sky: skyAt(now.getHours()),
			weather: weatherOf(lounge),
			lampOn: !lounge?.lampOff,
			seated: seatedOf(riders, rider?.id),
			rider,
			...music(),
			catAwakeUntil,
			hearts,
			watt,
			hours: now.getHours(),
			minutes: now.getMinutes(),
		});
	}

	// Reduced motion holds a frame a second, so who sits where and the lamp
	// still follow the channel.
	$effect(() => {
		if (!canvas) return;
		const target = canvas;
		const still = prefersReducedMotion.current;
		watt =
			getComputedStyle(target).getPropertyValue('--color-watt').trim() || watt;
		return untrack(() =>
			sceneLoop(target, (g, dt) => frame(g, dt, still), still),
		);
	});

	$effect(() => {
		if (radioOn) radio?.start();
		else radio?.stop();
	});
	$effect(() => {
		const ceiling = radioOn ? mixer.music / 100 : 0;
		const depth = mixer.duck;
		return onDuck(({ down, ms }) =>
			radio?.setLevel(down ? ceiling * depth : ceiling, ms),
		);
	});
	$effect(() => radio?.setRain(weatherOf(lounge) === 'rain'));
	$effect(() => {
		if (!radioOn) {
			nowPlaying = '';
			return;
		}
		const say = () => {
			const p = positionAt(station, serverNow() / 1000);
			nowPlaying = `“${p.tune.name}” · ${KEY_NAMES[p.tune.key]} · ${p.tune.bpm} BPM`;
		};
		say();
		const every = setInterval(say, 1000);
		return () => clearInterval(every);
	});
	// A context made before any click starts suspended; the first one wakes it.
	$effect(() => {
		const wake = () => radio?.resume();
		window.addEventListener('pointerdown', wake, { once: true });
		return () => window.removeEventListener('pointerdown', wake);
	});

	function toggleRadio() {
		wanted = !wanted;
		setRadioWanted(wanted);
	}

	function at(e: MouseEvent) {
		const box = canvas!.getBoundingClientRect();
		const x = ((e.clientX - box.left) / box.width) * SCENE_W;
		const y = ((e.clientY - box.top) / box.height) * SCENE_H;
		return { x, spot: spotAt(x, y) };
	}

	function click(e: MouseEvent) {
		const { x, spot } = at(e);
		const state = { lampOff: !!lounge?.lampOff, weather: weatherOf(lounge) };
		if (spot === 'lamp') live?.setLounge({ ...state, lampOff: !state.lampOff });
		else if (spot === 'window')
			live?.setLounge({ ...state, weather: nextWeather(state.weather) });
		else if (spot === 'cat') catAwakeUntil = clock + 4;
		else if (spot === 'deck' && deckIdle) toggleRadio();
		else if (spot === 'sofa') {
			const riders = channel.riders;
			const seat = seatAt(x, seatedOf(riders, riderOf(riders, 0)?.id).length);
			if (seat >= 0)
				hearts = [
					...hearts.filter((h) => clock - h.born < 2),
					{ seat, born: clock },
				];
		}
	}
</script>

<section class="mb-4" aria-label="the lounge" bind:clientWidth={width}>
	<canvas
		bind:this={canvas}
		width={SCENE_W}
		height={SCENE_H}
		onclick={click}
		onmousemove={(e) =>
			(canvas!.style.cursor = at(e).spot ? 'pointer' : 'default')}
		class="border-neon/40 block border [image-rendering:pixelated]"
		style:width="{SCENE_W * scale}px"
		style:height="{SCENE_H * scale}px"
		aria-label="The lounge: who is in the call, on the sofa or on the bike. Click the lamp, the window or the cat."
	></canvas>
	{#if deckIdle}
		<div class="text-muted mt-2 flex flex-wrap items-center gap-2 text-xs">
			<button
				type="button"
				onclick={toggleRadio}
				aria-pressed={wanted}
				class="btn btn-ghost btn-xs {wanted ? 'text-ink' : ''}"
				><Radio size={13} /> House radio</button
			>
			{#if nowPlaying}<span class="tabular-nums">{nowPlaying}</span>{/if}
			{#if wanted && mixer.music === 0}<span>Music is at 0 in your mix.</span
				>{/if}
		</div>
	{/if}
</section>
