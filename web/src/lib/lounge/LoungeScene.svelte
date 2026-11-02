<script lang="ts">
	// The lounge (ADR-0094): the room a voice channel is while the cozy room
	// is on (#4305). The page decides when it shows (#4302); this draws it to
	// fill the page, at the biggest whole pixel the height allows, in the
	// rider's theme. Everyone in the call is in it, with their name and marks
	// hung under them here in the page. A screen too narrow for the room pans
	// across it. House radio is queued on the deck like a track and
	// HouseRadioDeck plays it.
	import { tick, untrack } from 'svelte';
	import Disc3 from '@lucide/svelte/icons/disc-3';
	import Bike from '@lucide/svelte/icons/bike';
	import Drum from '@lucide/svelte/icons/drum';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import ScreenShare from '@lucide/svelte/icons/screen-share';
	import Video from '@lucide/svelte/icons/video';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { useChannel } from '$lib/channel/context';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { playheadAt } from '$lib/channel/playhead';
	import { tileFrame } from '$lib/channel/presence-marks';
	import { awayState } from '$lib/away';
	import {
		MENU_HINT,
		contextMenu,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { serverNow } from '$lib/server-clock';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { fnv } from '$lib/world/loadout';
	import { radioHeard } from '$lib/lounge/radio-heard.svelte';
	import { sceneLoop } from '$lib/lounge/scene-loop';
	import {
		KEY_NAMES,
		STYLE_NAMES,
		drumsIn,
		positionAt,
	} from '$lib/lounge/station';
	import { nextWeather, weatherOf } from '$lib/lounge/state';
	import { crewOf, riderOf } from '$lib/lounge/figures';
	import {
		catAt,
		cuckooing,
		discoOn,
		flybyAt,
		seasonOf,
	} from '$lib/lounge/moments';
	import { palette } from '$lib/palette.svelte';
	import { LOUNGE, applyLoungeTheme, skyAt } from '$lib/lounge/palette';
	import { forgetWalls, shadeFor } from '$lib/lounge/draw-room';
	import { forgetBackdrops } from '$lib/lounge/draw-window';
	import {
		SCENE_H,
		SCENE_W,
		drawScene,
		middleOf,
		spotAt,
		tagsOf,
		type Heart,
		type SceneInput,
	} from '$lib/lounge/scene';

	let { menuOf }: { menuOf: (id: string) => MenuEntry[] } = $props();

	/**
	 * The fewest rows a room at scale s draws: the middle, the cushions in
	 * front of it, and under them their names and the radio's line, which are
	 * page pixels and so take fewer rows the bigger the scale.
	 */
	const rowsAt = (s: number) => SCENE_H + 23 + Math.ceil(48 / s);
	/** How fast the room may darken or brighten, per second: a lamp flipped on and off quickly fades instead of flashing (WCAG 2.3.1). */
	const SHADE_RATE = 0.3;
	const KONAMI = [
		'ArrowUp',
		'ArrowUp',
		'ArrowDown',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'ArrowLeft',
		'ArrowRight',
		'b',
		'a',
	];

	const channel = useChannel();
	const live = $derived(channelConnection.current?.live);
	const deck = $derived(live?.tick?.jukebox);
	const lounge = $derived(live?.tick?.lounge);
	const station = $derived(channel.address.crew);
	const seed = $derived(fnv(station));

	const onAir = $derived(!!deck?.current?.radio);

	let boxW = $state(0);
	let boxH = $state(0);
	// The biggest whole pixel the height takes, and never so big that a phone
	// sees less than half the middle; it pans the rest.
	const scale = $derived.by(() => {
		let s = Math.max(1, Math.min(5, Math.floor(boxW / (SCENE_W / 2))));
		while (s > 1 && boxH / s < rowsAt(s)) s--;
		return s;
	});
	const roomW = $derived(Math.max(SCENE_W, Math.floor(boxW / scale)));
	const roomH = $derived(Math.max(rowsAt(scale), Math.floor(boxH / scale)));
	// Read by the frame on every tick, outside the effect that starts the loop.
	let size = { w: SCENE_W, h: rowsAt(1) };
	$effect(() => {
		size = { w: roomW, h: roomH };
	});

	const crew = $derived(crewOf(channel.riders, 0, roomW));
	const tags = $derived(tagsOf(crew, roomW, roomH));
	const byId = $derived(new Map(channel.riders.map((r) => [r.id, r])));
	/** Where the canvas's top sits in the box: above it when the box is too short. */
	const top = $derived(boxH - roomH * scale);

	let canvas = $state<HTMLCanvasElement | null>(null);
	let pan = $state<HTMLElement | null>(null);
	let wall = $state('');
	let hearts: Heart[] = [];
	let catAwakeUntil = 0;
	let cuckooUntil = 0;
	let mugUntil = 0;
	let scratchUntil = 0;
	let waveAt = -Infinity;
	let clock = 0;
	let crank = 0.9;
	let shade = -1;
	let nowPlaying = $state('');

	// Before the loop's effect, so the first frame is already in the theme.
	$effect(() => {
		if (applyLoungeTheme(palette.active)) {
			forgetWalls();
			forgetBackdrops();
		}
		wall = LOUNGE.wall;
	});

	// A room wider than the screen opens on its middle, the sofa and the bike.
	$effect(() => {
		const over = roomW * scale - boxW;
		const el = pan;
		if (el && over > 0) void tick().then(() => (el.scrollLeft = over / 2));
	});

	function music(): Pick<SceneInput, 'playing' | 'beat' | 'pulsing' | 'disco'> {
		const current = deck?.current;
		if (current?.radio) {
			const p = positionAt(station, serverNow() / 1000);
			return {
				playing: deck!.playing,
				beat: p.beat,
				pulsing: deck!.playing && drumsIn(p.tune, p.section),
				disco: deck!.playing && discoOn(p.section, p.tune.slot),
			};
		}
		if (current) {
			const bpm = current.bpm ?? 0;
			const at = playheadAt(deck!, serverNow());
			return {
				playing: deck!.playing,
				beat: (at * bpm) / 60,
				pulsing: deck!.playing && bpm > 0,
				disco: false,
			};
		}
		return { playing: false, beat: 0, pulsing: false, disco: false };
	}

	function frame(g: CanvasRenderingContext2D, dt: number, still: boolean) {
		// The clock runs either way: reduced motion holds the picture, not time,
		// so a heart or an awake cat still passes.
		clock += dt;
		const riders = channel.riders;
		const onBike = riders.find((r) => r.id === riderOf(riders, 0)?.id);
		if (onBike && !still)
			crank += ((onBike.cadence || 80) / 60) * Math.PI * 2 * dt;
		const now = new Date();
		const sec = serverNow() / 1000;
		const sky = skyAt(now.getHours());
		const lampOn = !lounge?.lampOff;
		const dark = shadeFor(lampOn, sky);
		shade =
			still || shade < 0
				? dark
				: shade +
					Math.max(-SHADE_RATE * dt, Math.min(SHADE_RATE * dt, dark - shade));
		drawScene(g, {
			...size,
			t: clock,
			still,
			sky,
			weather: weatherOf(lounge),
			lampOn,
			crew: crewOf(riders, crank, size.w),
			...music(),
			cat: catAt(seed, sec),
			catAwake: clock < catAwakeUntil,
			hearts,
			hours: now.getHours(),
			minutes: now.getMinutes(),
			cuckoo:
				cuckooing(now.getMinutes(), now.getSeconds()) || clock < cuckooUntil,
			shade,
			flyby: flybyAt(seed, sec),
			mugDown: clock < mugUntil,
			scratch: clock < scratchUntil,
			season: seasonOf(now),
			waveAt,
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
			nowPlaying = `“${p.tune.name}” · ${STYLE_NAMES[p.tune.style]} · ${KEY_NAMES[p.tune.key]} · ${p.tune.bpm} BPM`;
		};
		say();
		const every = setInterval(say, 1000);
		return () => clearInterval(every);
	});

	function heart(x: number, y: number) {
		hearts = [
			...hearts.filter((h) => clock - h.born < 2),
			{ x, y, born: clock },
		];
	}

	/** Wake the cat here, with a heart over it. */
	function wake() {
		const cat = catAt(seed, serverNow() / 1000);
		const { ox, oy } = middleOf(roomW, roomH);
		catAwakeUntil = clock + 4;
		heart(ox + cat.x - 2, oy + cat.y - 24);
	}

	// A pet is the channel's (LoungeState.pets): every screen wakes its cat
	// when the count goes up, and every fifth pet the cat knocks the mug off
	// the desk. Your own pets woke it already, on the click.
	let petsSeen: number | undefined;
	let ownPets = 0;
	$effect(() => {
		const pets = lounge?.pets ?? 0;
		untrack(() => {
			const was = petsSeen;
			petsSeen = pets;
			if (was === undefined || pets <= was) return;
			const fresh = pets - was;
			if (fresh > ownPets) wake();
			ownPets = Math.max(0, ownPets - fresh);
			if (Math.floor(pets / 5) > Math.floor(was / 5)) mugUntil = clock + 30;
		});
	});

	/** A pointer in room pixels and in the middle's, and who or what it is over. */
	function at(e: MouseEvent) {
		const box = canvas!.getBoundingClientRect();
		const x = ((e.clientX - box.left) / box.width) * roomW;
		const y = ((e.clientY - box.top) / box.height) * roomH;
		const { ox, oy } = middleOf(roomW, roomH);
		const cat = catAt(seed, serverNow() / 1000);
		return {
			who: tags.find(
				(t) => Math.abs(x - t.x) <= 6 && y >= t.head - 2 && y <= t.head + 22,
			),
			cat:
				Math.abs(x - ox - cat.x) <= 11 &&
				y - oy <= cat.y + 1 &&
				y - oy >= cat.y - 20,
			spot: spotAt(x - ox, y - oy),
		};
	}

	function click(e: MouseEvent) {
		const { who, cat, spot } = at(e);
		const state = { ...lounge, weather: weatherOf(lounge) };
		if (who) heart(who.x - 2, who.head - 7);
		else if (cat) {
			ownPets++;
			wake();
			live?.setLounge({ ...state, pets: (lounge?.pets ?? 0) + 1 });
		} else if (spot === 'lamp')
			live?.setLounge({ ...state, lampOff: !state.lampOff });
		else if (spot === 'window')
			live?.setLounge({ ...state, weather: nextWeather(state.weather) });
		else if (spot === 'clock') cuckooUntil = clock + 3;
		else if (spot === 'deck') scratchUntil = clock + 0.8;
	}

	let typed = 0;
	function key(e: KeyboardEvent) {
		if (
			(e.target as HTMLElement | null)?.closest?.(
				'input, textarea, [contenteditable]',
			)
		)
			return;
		typed = e.key === KONAMI[typed] ? typed + 1 : e.key === KONAMI[0] ? 1 : 0;
		if (typed < KONAMI.length) return;
		typed = 0;
		waveAt = clock;
	}

	/** What a tag says for a screen reader: the name, then what the marks show. */
	function described(id: string): string {
		const r = byId.get(id);
		if (!r) return '';
		const marks = [
			r.away && awayState(r.awayReason).label.toLowerCase(),
			r.speaking && 'talking',
			r.muted && 'muted',
			r.riding && 'riding',
			r.cameraOn && 'camera on',
			r.sharing && 'sharing a screen',
			r.sounding && 'playing a sound',
			r.linkLost && 'connection lost',
		].filter(Boolean);
		return [r.you ? `${r.name} (you)` : r.name, ...marks].join(', ');
	}
</script>

<svelte:window onkeydown={key} />

<!-- The room is the page here: it fills the place to its edges, and the
     page's own buttons float over its wall. -->
<section
	class="relative min-h-0 flex-1 overflow-hidden"
	aria-label="the lounge"
	style:background={wall}
	bind:clientWidth={boxW}
	bind:clientHeight={boxH}
>
	<div
		bind:this={pan}
		class="absolute inset-0 [scrollbar-width:none] overflow-x-auto overflow-y-hidden"
	>
		<div class="relative mx-auto h-full" style:width="{roomW * scale}px">
			<canvas
				bind:this={canvas}
				width={roomW}
				height={roomH}
				onclick={click}
				onmousemove={(e) => {
					const over = at(e);
					canvas!.style.cursor =
						over.who || over.cat || over.spot ? 'pointer' : 'default';
				}}
				class="absolute bottom-0 left-0 block [image-rendering:pixelated]"
				style:width="{roomW * scale}px"
				style:height="{roomH * scale}px"
				aria-label="The lounge: who is in the call, on the sofa, the cushions or the bike. Click someone to send a heart, or the cat, the lamp, the window, the clock or the record player."
			></canvas>
			<div role="group" aria-label="in the call">
				{#each tags as tag (tag.id)}
					{@const r = byId.get(tag.id)}
					{#if r}
						{@const Away = awayState(r.awayReason).icon}
						<button
							type="button"
							{@attach contextMenu(() => menuOf(tag.id))}
							onclick={() => heart(tag.x - 2, tag.head - 7)}
							title={MENU_HINT}
							aria-label={described(tag.id)}
							class="bg-surface/85 text-ink absolute flex -translate-x-1/2 items-center gap-1 rounded-full px-1.5 py-0.5 leading-none font-medium whitespace-nowrap {scale >=
							3
								? 'text-xs'
								: 'text-[10px]'} {tileFrame(r.speaking, r.away)} {r.away
								? 'opacity-70'
								: ''} {r.you ? 'border-neon/60 border' : ''}"
							style:left="{tag.x * scale}px"
							style:top="{top + tag.y * scale}px"
							style:max-width="{Math.max(56, tag.span * scale)}px"
						>
							{#if r.away}<Away size={12} class="text-muted shrink-0" />{/if}
							<span class="min-w-0 truncate">{r.name}</span>
							{#if r.muted}<MicOff size={12} class="text-muted shrink-0" />{/if}
							{#if r.riding && tag.id !== crew.rider?.id}<Bike
									size={12}
									class="text-muted shrink-0"
								/>{/if}
							{#if r.cameraOn}<Video
									size={12}
									class="text-muted shrink-0"
								/>{/if}
							{#if r.sharing}<ScreenShare
									size={12}
									class="text-muted shrink-0"
								/>{/if}
							{#if r.sounding}<Drum
									size={12}
									class="text-muted shrink-0"
								/>{/if}
							{#if r.linkLost}<WifiOff
									size={12}
									class="text-muted shrink-0"
								/>{/if}
						</button>
					{/if}
				{/each}
			</div>
		</div>
	</div>
	{#if onAir}
		<div
			class="bg-surface/85 text-muted absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-2 rounded px-2 py-1 text-xs"
		>
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
			{#if nowPlaying}<span class="tabular-nums max-sm:hidden"
					>{nowPlaying}</span
				>{/if}
			{#if radioHeard.current && mixer.music === 0}<span
					>Music is at 0 in your mix.</span
				>{/if}
		</div>
	{/if}
</section>
