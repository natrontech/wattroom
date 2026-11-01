<script lang="ts">
	// The lounge (ADR-0094): the room an idle voice channel is. The page
	// decides when it shows and gives it the space left over (#4302); this
	// draws as much room as fits, at the finest pixel the size allows, in the
	// rider's theme. House radio is queued on the deck like a track and
	// HouseRadioDeck plays it.
	import { untrack } from 'svelte';
	import Disc3 from '@lucide/svelte/icons/disc-3';
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
	import { palette } from '$lib/palette.svelte';
	import { applyLoungeTheme, skyAt } from '$lib/lounge/palette';
	import { forgetWalls } from '$lib/lounge/draw-room';
	import { forgetBackdrops } from '$lib/lounge/draw-window';
	import {
		SCENE_H,
		SCENE_W,
		drawScene,
		middleOf,
		seatAt,
		spotAt,
		type Heart,
		type SceneInput,
	} from '$lib/lounge/scene';

	/**
	 * CSS pixels per scene pixel: one on a phone, two on a desk, three only on
	 * a very wide one. A wider page shows more room rather than bigger pixels.
	 */
	function scaleFor(boxW: number): number {
		const wanted = boxW < 720 ? 1 : boxW < 1700 ? 2 : 3;
		return Math.max(1, Math.min(wanted, Math.floor(boxW / SCENE_W)));
	}
	/** Past this the room is only more wallpaper above the furniture. */
	const MAX_ROWS = 260;

	const channel = useChannel();
	const live = $derived(channelConnection.current?.live);
	const deck = $derived(live?.tick?.jukebox);
	const lounge = $derived(live?.tick?.lounge);
	const station = $derived(channel.address.crew);

	const deckIdle = $derived(!deck?.current);
	const onAir = $derived(!!deck?.current?.radio);

	let boxW = $state(0);
	let viewH = $state(900);
	const scale = $derived(scaleFor(boxW));
	const roomW = $derived(Math.max(SCENE_W, Math.floor(boxW / scale)));
	// Half as tall as it is wide, and never so tall the tiles and the
	// session's buttons leave the screen.
	const roomH = $derived(
		Math.max(
			SCENE_H,
			Math.min(
				MAX_ROWS,
				Math.floor(roomW / 2),
				Math.floor((viewH * 0.6) / scale),
			),
		),
	);
	// Read by the frame on every tick, outside the effect that starts the loop.
	let size = { w: SCENE_W, h: SCENE_H };
	$effect(() => {
		size = { w: roomW, h: roomH };
	});

	let canvas = $state<HTMLCanvasElement | null>(null);
	let hearts = $state<Heart[]>([]);
	let catAwakeUntil = $state(0);
	let clock = 0;
	let crank = 0.9;
	let nowPlaying = $state('');

	// Before the loop's effect, so the first frame is already in the theme.
	$effect(() => {
		if (applyLoungeTheme(palette.active)) {
			forgetWalls();
			forgetBackdrops();
		}
	});

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
			...size,
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

	/** A pointer in the middle's coordinates, and what it is over. */
	function at(e: MouseEvent) {
		const box = canvas!.getBoundingClientRect();
		const { ox, oy } = middleOf(roomW, roomH);
		const x = ((e.clientX - box.left) / box.width) * roomW - ox;
		const y = ((e.clientY - box.top) / box.height) * roomH - oy;
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

<svelte:window bind:innerHeight={viewH} />

<!-- The room bleeds to the content column's edges: it is the page here,
     not a picture on it. The canvas sits in it at a whole-pixel scale, so the
     box's last pixel or two of width shows the page behind it. -->
<section class="mb-4" aria-label="the lounge">
	<div
		class="relative -mx-4 overflow-hidden sm:-mx-8"
		bind:clientWidth={boxW}
		style:height="{roomH * scale}px"
	>
		<canvas
			bind:this={canvas}
			width={roomW}
			height={roomH}
			onclick={click}
			onmousemove={(e) =>
				(canvas!.style.cursor = at(e).spot ? 'pointer' : 'default')}
			class="absolute bottom-0 block [image-rendering:pixelated]"
			style:left="{Math.floor((boxW - roomW * scale) / 2)}px"
			style:width="{roomW * scale}px"
			style:height="{roomH * scale}px"
			aria-label="The lounge: who is in the call, on the sofa or on the bike. Click the lamp, the window or the cat."
		></canvas>
	</div>
	{#if deckIdle}
		<div class="text-muted mt-2 flex flex-wrap items-center gap-2 text-xs">
			<button
				type="button"
				onclick={queueRadio}
				class="btn btn-ghost btn-xs px-0"
				><Disc3 size={13} /> Queue house radio</button
			>
			<span>Lofi made for your crew, the same bar on every screen.</span>
		</div>
	{:else if onAir}
		<div class="text-muted mt-2 flex flex-wrap items-center gap-2 text-xs">
			<button
				type="button"
				onclick={() => radioHeard.set(!radioHeard.current)}
				aria-pressed={radioHeard.current}
				class="btn btn-ghost btn-xs px-0 {radioHeard.current ? 'text-ink' : ''}"
				><Disc3 size={13} />
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
