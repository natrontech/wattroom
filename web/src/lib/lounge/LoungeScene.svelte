<script lang="ts">
	// The lounge (ADR-0094): the picture an idle voice channel shows. The page
	// decides when it shows; this draws it and keeps its clock. House radio is
	// queued on the deck like a track and HouseRadioDeck plays it.
	import { untrack } from 'svelte';
	import Radio from '@lucide/svelte/icons/radio';
	import { useChannel } from '$lib/channel/context';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { playheadAt } from '$lib/channel/playhead';
	import { serverNow } from '$lib/server-clock';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { radioHeard } from '$lib/lounge/radio-heard.svelte';
	import { sceneLoop } from '$lib/lounge/scene-loop';
	import { KEY_NAMES, drumsIn, positionAt } from '$lib/lounge/station';
	import { nextWeather, weatherOf } from '$lib/lounge/state';
	import { riderOf, seatedOf } from '$lib/lounge/figures';
	import { LOUNGE, skyAt } from '$lib/lounge/palette';
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

	const deckIdle = $derived(!deck?.current);
	const onAir = $derived(!!deck?.current?.radio);

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
	let watt: string = LOUNGE.watt;

	function music(): Pick<SceneInput, 'playing' | 'beat' | 'pulsing'> {
		const current = deck?.current;
		if (current?.radio) {
			const p = positionAt(station, serverNow() / 1000);
			return {
				playing: deck!.playing,
				beat: p.beat,
				pulsing: deck!.playing && drumsIn(p.section),
			};
		}
		if (current) {
			const bpm = current.bpm ?? 0;
			const at = playheadAt(deck!, serverNow());
			return {
				playing: deck!.playing,
				beat: (at * bpm) / 60,
				pulsing: deck!.playing && bpm > 0,
			};
		}
		return { playing: false, beat: 0, pulsing: false };
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
		if (!onAir) {
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

	function queueRadio() {
		live?.jukebox({ action: 'add', radio: true });
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
		else if (spot === 'deck' && deckIdle) queueRadio();
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
			<button type="button" onclick={queueRadio} class="btn btn-ghost btn-xs"
				><Radio size={13} /> Queue house radio</button
			>
			<span>Lofi made for your crew, the same bar on every screen.</span>
		</div>
	{:else if onAir}
		<div class="text-muted mt-2 flex flex-wrap items-center gap-2 text-xs">
			<button
				type="button"
				onclick={() => radioHeard.set(!radioHeard.current)}
				aria-pressed={radioHeard.current}
				class="btn btn-ghost btn-xs {radioHeard.current ? 'text-ink' : ''}"
				><Radio size={13} />
				{radioHeard.current
					? 'Hearing house radio'
					: 'House radio muted here'}</button
			>
			{#if nowPlaying}<span class="tabular-nums">{nowPlaying}</span>{/if}
			{#if radioHeard.current && mixer.music === 0}<span
					>Music is at 0 in your mix.</span
				>{/if}
		</div>
	{/if}
</section>
