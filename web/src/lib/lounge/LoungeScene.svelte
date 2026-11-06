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
	import SkipForward from '@lucide/svelte/icons/skip-forward';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Bike from '@lucide/svelte/icons/bike';
	import Drum from '@lucide/svelte/icons/drum';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import ScreenShare from '@lucide/svelte/icons/screen-share';
	import Video from '@lucide/svelte/icons/video';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { useChannel } from '$lib/channel/context';
	import { channelConnection } from '$lib/channel/connection.svelte';
	import { playheadAt } from '$lib/channel/playhead';
	import { awayState } from '$lib/away';
	import {
		MENU_HINT,
		contextMenu,
		openMenu,
		type MenuEntry,
	} from '$lib/context-menu.svelte';
	import { serverNow } from '$lib/server-clock';
	import type { LoungeState } from '$lib/protocol';
	import { goto } from '$app/navigation';
	import { sessionPath } from '$lib/channel/address';
	import { device } from '$lib/device.svelte';
	import { crewLive } from '$lib/nav/crew-live.svelte';
	import { fetchPins } from '$lib/pins/pins';
	import { NO_MEMORY, fetchRoomMemory } from '$lib/lounge/memory';
	import { mixer } from '$lib/sound/mixer.svelte';
	import { prefersReducedMotion } from '$lib/motion';
	import { fnv } from '$lib/world/loadout';
	import { radioHeard } from '$lib/lounge/radio-heard.svelte';
	import LookEditor from '$lib/lounge/LookEditor.svelte';
	import { sceneLoop } from '$lib/lounge/scene-loop';
	import {
		KEY_NAMES,
		STYLE_NAMES,
		drumsIn,
		positionAt,
	} from '$lib/lounge/station';
	import {
		MOODS,
		RADIO_PICKS,
		moodOf,
		nextWeather,
		radioPickOf,
		skipShift,
		stationPick,
		weatherOf,
		type Mood,
		type RadioPick,
	} from '$lib/lounge/state';
	import { recordAt } from '$lib/lounge/records';
	import { cooled, crewOf } from '$lib/lounge/figures';
	import {
		catAt,
		cuckooing,
		discoOn,
		flybyAt,
		fondueNight,
		momentOf,
		owlHours,
		pizzaNight,
		seasonOf,
		VISITORS,
		visitorAt,
		type Visitor,
	} from '$lib/lounge/moments';
	import Album from '$lib/lounge/Album.svelte';
	import {
		VISITOR_NOTES,
		fetchAlbum,
		saveSighting,
		type Sighting,
	} from '$lib/lounge/album';
	import { toasts } from '$lib/toast.svelte';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import { palette } from '$lib/palette.svelte';
	import { LOUNGE, applyLoungeTheme, skyAt } from '$lib/lounge/palette';
	import { forgetWalls, shadeFor } from '$lib/lounge/draw-room';
	import { forgetBackdrops } from '$lib/lounge/draw-window';
	import {
		SAFE_W,
		SCENE_H,
		SCENE_W,
		drawScene,
		hasFront,
		middleOf,
		spotAt,
		tagsOf,
		type Heart,
		type SceneInput,
	} from '$lib/lounge/scene';

	let { menuOf }: { menuOf: (id: string) => MenuEntry[] } = $props();

	/** The fewest rows a room at scale s draws: the stage, and under it the radio's line in page pixels. */
	const rowsAt = (s: number) => SCENE_H + Math.ceil(28 / s);
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
	const live = $derived(channelConnection.call?.live);
	const deck = $derived(live?.tick?.jukebox);
	const lounge = $derived(live?.tick?.lounge);
	const station = $derived(channel.address.crew);
	const seed = $derived(fnv(station));

	const onAir = $derived(!!deck?.current?.radio);
	/** House radio's style, picked in its crate for everyone; '' is records. */
	const pick = $derived(radioPickOf(lounge));
	/** How far the channel skipped house radio ahead, and the stove's slower tunes. */
	const shift = $derived(lounge?.radioShiftMs ?? 0);
	const fire = $derived(!!lounge?.fire);
	const mood = $derived(moodOf(lounge));

	let boxW = $state(0);
	let boxH = $state(0);
	// The biggest whole pixel at which all that matters on the stage fits (a
	// 1200 px box takes 4). A phone is never under 2: it sees the middle of
	// the stage and pans the rest.
	const scale = $derived.by(() => {
		let s = Math.max(1, Math.min(6, Math.floor(boxW / SAFE_W)));
		while (s > 1 && boxH / s < rowsAt(s)) s--;
		return s >= 2 || boxH / 2 < rowsAt(2) ? s : 2;
	});
	const roomW = $derived(Math.max(SCENE_W, Math.floor(boxW / scale)));
	const roomH = $derived(Math.max(rowsAt(scale), Math.floor(boxH / scale)));
	// Read by the frame on every tick, outside the effect that starts the loop.
	let size = { w: SCENE_W, h: rowsAt(1) };
	$effect(() => {
		size = { w: roomW, h: roomH };
	});

	const crew = $derived(crewOf(channel.riders, 0, roomW, roomH));
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
	let fishUntil = 0;
	let bloomUntil = 0;
	let arcadeUntil = 0;
	let waveAt = -Infinity;
	let clock = 0;
	let shade = -1;
	let nowPlaying = $state('');
	/** Your look's editor is open: you clicked yourself. */
	let dressing = $state(false);
	let styleNow = $state<keyof typeof STYLE_NAMES>('lofi');

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
		// Records carry no tempo to dance to.
		if (current?.radio && !pick)
			return { playing: deck!.playing, beat: 0, pulsing: false, disco: false };
		if (current?.radio) {
			const p = positionAt(
				station,
				(serverNow() + shift) / 1000,
				stationPick(pick),
				fire,
			);
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

	/** The chalkboard's two lines: when the crew's next plan starts. */
	const chalked = $derived.by(() => {
		const at = channel.plan?.startsAt;
		if (!at) return undefined;
		const when = new Date(at);
		const today = when.toDateString() === new Date().toDateString();
		return {
			day: today
				? 'TODAY'
				: when.toLocaleDateString('en', { weekday: 'short' }).toUpperCase(),
			time: when.toLocaleTimeString('en-GB', {
				hour: '2-digit',
				minute: '2-digit',
			}),
		};
	});
	/** The crew's session running now, if any: the laptop shows it. */
	const running = $derived(
		crewLive.crews.find((c) => c.id === station)?.sessions?.[0],
	);
	/** How many notes the corkboard holds: the crew's pins. */
	let pins = $state(0);
	$effect(() => {
		const crew = station;
		void fetchPins(crew).then((res) => {
			if (res.ok && crew === station) pins = res.data.length;
		});
	});

	/** The crew's album of visitors: what it has seen, and when. */
	let album = $state<Sighting[]>([]);
	let albumLoaded = false;
	let browsing = $state(false);
	$effect(() => {
		const crew = station;
		albumLoaded = false;
		void fetchAlbum(crew).then((seen) => {
			if (crew !== station) return;
			album = seen;
			albumLoaded = true;
		});
	});
	/** A visitor on screen: the first time, it goes in the album. */
	function noteVisitor(kind: Visitor) {
		if (!albumLoaded || album.some((s) => s.kind === kind)) return;
		album = [...album, { kind, seenAt: new Date().toISOString() }];
		void saveSighting(station, kind);
		toasts.push(`New in the album: ${VISITOR_NOTES[kind].name}.`);
	}

	/** What the room remembers of the crew (memory.ts). */
	let memory = $state(NO_MEMORY);
	$effect(() => {
		const crew = station;
		void fetchRoomMemory(crew).then((seen) => {
			if (crew === station) memory = seen;
		});
	});

	/** Who rode a frame ago, and who keeps a towel on until when (figures.ts). */
	let ridingSeen: Set<string> = new Set();
	let coolingUntil: Map<string, number> = new Map();

	function frame(g: CanvasRenderingContext2D, dt: number, still: boolean) {
		// The clock runs either way: reduced motion holds the picture, not time,
		// so a heart or an awake cat still passes.
		clock += dt;
		const riders = channel.riders;
		const off = cooled(riders, ridingSeen, coolingUntil, clock);
		ridingSeen = off.riding;
		coolingUntil = off.until;
		const now = new Date();
		const sec = serverNow() / 1000;
		// A mood brings its own sky; otherwise the window keeps the viewer's hour.
		const sky = mood ? MOODS[mood].sky : skyAt(now.getHours());
		const lampOn = !lounge?.lampOff;
		const dark = shadeFor(lampOn, sky, fire);
		shade =
			still || shade < 0
				? dark
				: shade +
					Math.max(-SHADE_RATE * dt, Math.min(SHADE_RATE * dt, dark - shade));
		const visitor = visitorAt(seed, sec, {
			sky,
			weather: weatherOf(lounge),
			lampOn,
			moment: momentOf(now),
			season: seasonOf(now),
			pizza: pizzaNight(now),
			christmasEve: now.getMonth() === 11 && now.getDate() === 24,
		});
		if (visitor) noteVisitor(visitor.kind);
		drawScene(g, {
			...size,
			visitor,
			t: clock,
			still,
			sky,
			weather: weatherOf(lounge),
			lampOn,
			crew: crewOf(
				riders,
				still ? 0 : clock,
				size.w,
				size.h,
				new Set(coolingUntil.keys()),
			),
			...music(),
			...(mood === 'arcade' && { disco: true }),
			fire,
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
			radio: pick,
			fishJump: clock < fishUntil,
			bloom: clock < bloomUntil,
			arcade: clock < arcadeUntil || mood === 'arcade',
			pizza: pizzaNight(now),
			fondue: fondueNight(now),
			moment: momentOf(now),
			club: {
				plan: chalked,
				pins,
				live: running?.riders.length ?? 0,
				...memory,
			},
			owl: owlHours(now.getHours()),
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
			const at = (serverNow() + shift) / 1000;
			if (!pick) {
				const { record } = recordAt(station, at);
				nowPlaying = `“${record.title}” · ${record.artist}`;
				return;
			}
			const p = positionAt(station, at, stationPick(pick), fire);
			nowPlaying = `“${p.tune.name}” · ${KEY_NAMES[p.tune.key]} · ${p.tune.bpm} BPM`;
			styleNow = p.tune.style;
		};
		say();
		const every = setInterval(say, 1000);
		return () => clearInterval(every);
	});

	/** Someone clicked: a heart for them, or for yourself your look's editor. */
	function touch(tag: { id: string; x: number; head: number }) {
		if (byId.get(tag.id)?.you) dressing = true;
		else heart(tag.x - 2, tag.head - 8);
	}

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
				(t) => Math.abs(x - t.x) <= 7 && y >= t.head - 2 && y <= t.y,
			),
			cat:
				Math.abs(x - ox - cat.x) <= 11 &&
				y - oy <= cat.y + 1 &&
				y - oy >= cat.y - 20,
			spot: spotAt(x - ox, y - oy, hasFront(roomW, roomH)),
		};
	}

	function click(e: MouseEvent) {
		const { who, cat, spot } = at(e);
		// A flip by hand leaves the mood: the room is no longer its preset.
		const state = { ...lounge, weather: weatherOf(lounge), mood: '' };
		if (who) touch(who);
		else if (cat) {
			ownPets++;
			wake();
			live?.setLounge({
				...lounge,
				weather: weatherOf(lounge),
				pets: (lounge?.pets ?? 0) + 1,
			});
		} else if (spot === 'lamp')
			live?.setLounge({ ...state, lampOff: !state.lampOff });
		else if (spot === 'window')
			live?.setLounge({ ...state, weather: nextWeather(state.weather) });
		else if (spot === 'clock') cuckooUntil = clock + 3;
		else if (spot === 'deck') (onAir ? next : playRadio)();
		// Lit, the generated styles start one of their slower tunes; records play on.
		else if (spot === 'stove') {
			if (pick === '') live?.setLounge({ ...state, fire: !fire });
			else retune({ fire: !fire });
		} else if (spot === 'fish') fishUntil = clock + 1.2;
		else if (spot === 'plant') bloomUntil = clock + 30;
		else if (spot === 'arcade') arcadeUntil = clock + 8;
		else if (spot === 'board') void goto(`/crew/${station}/schedule`);
		else if (spot === 'cork') void goto(`/crew/${station}`);
		else if (spot === 'laptop' && running)
			void goto(sessionPath(station, running.id));
		else if (spot === 'bike' && !device.spectator)
			void goto(channel.address.training);
	}

	/**
	 * Anything that changes what house radio plays starts it from the top of
	 * a record or tune, on every screen at once: the skip goes with it.
	 */
	function retune(change: LoungeState & { radioStyle?: RadioPick }) {
		const style = change.radioStyle ?? pick;
		live?.setLounge({
			...lounge,
			weather: weatherOf(lounge),
			mood: '',
			...change,
			radioStyle: style,
			radioShiftMs: skipShift(station, style, shift, serverNow()),
		});
	}

	/** Next track, for everyone: the record player's click and the bar's button. */
	const next = () => retune({});

	/** House radio on the deck, as a song would go on: the empty record player's click. */
	const playRadio = () => live?.jukebox({ action: 'add', radio: true });

	const PICK_NAMES: Record<RadioPick, string> = {
		'': 'Records',
		mix: 'Mix',
		...STYLE_NAMES,
	};

	/** The crate of styles, under the style's name in the bar. */
	function crate(e: MouseEvent & { currentTarget: HTMLElement }) {
		const box = e.currentTarget.getBoundingClientRect();
		openMenu(
			RADIO_PICKS.map((p) => ({
				label: PICK_NAMES[p],
				icon: Disc3,
				hint: p === pick ? 'on' : undefined,
				onSelect: () => p !== pick && retune({ radioStyle: p }),
			})),
			box.left,
			box.top,
			e.currentTarget,
		);
	}

	/** One tap sets the window, lamp, stove and radio for everyone. */
	function moods(e: MouseEvent & { currentTarget: HTMLElement }) {
		const box = e.currentTarget.getBoundingClientRect();
		openMenu(
			(Object.keys(MOODS) as Mood[]).map((m) => ({
				label: MOODS[m].name,
				icon: Sparkles,
				hint: m === mood ? 'on' : undefined,
				onSelect: () => {
					const { weather, lampOff, fire, radio } = MOODS[m];
					if (m === mood) return;
					// Records keep playing through a mood that keeps records.
					if (radio === '' && pick === '')
						live?.setLounge({ ...lounge, weather, lampOff, fire, mood: m });
					else retune({ radioStyle: radio, weather, lampOff, fire, mood: m });
				},
			})),
			box.left,
			box.top,
			e.currentTarget,
		);
	}

	// Every screen scratches the record as the style changes or the channel
	// skips, the picker's too.
	let tuneSeen: string | undefined;
	$effect(() => {
		const now = `${pick}:${shift}`;
		untrack(() => {
			if (tuneSeen !== undefined && now !== tuneSeen)
				scratchUntil = clock + 0.8;
			tuneSeen = now;
		});
	});

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
				aria-label="The lounge: who is in the call, on the sofa, the cushions or a trainer. Click someone to send a heart, yourself to change your look, or the cat, the lamp, the window, the stove, the clock, the goldfish or the plant. The record player plays the next track for everyone."
			></canvas>
			<div role="group" aria-label="in the call">
				{#each tags as tag (tag.id)}
					{@const r = byId.get(tag.id)}
					{#if r}
						{@const Away = awayState(r.awayReason).icon}
						<button
							type="button"
							{@attach contextMenu(() => menuOf(tag.id))}
							onclick={() => touch(tag)}
							title={r.you ? 'Change your look' : MENU_HINT}
							aria-label={described(tag.id)}
							class="font-display pixel-words absolute flex -translate-x-1/2 items-center gap-1 leading-none font-semibold whitespace-nowrap {scale >=
							4
								? 'text-sm'
								: scale === 3
									? 'text-xs'
									: 'text-[11px]'} {r.away ? 'text-muted' : 'text-ink'} {r.you
								? 'decoration-neon underline decoration-2 underline-offset-2'
								: ''}"
							style:left="{tag.x * scale}px"
							style:top="{top + tag.y * scale}px"
							style:max-width="{Math.max(56, tag.span * scale)}px"
						>
							{#if r.away}<Away size={12} class="text-muted shrink-0" />{/if}
							<span class="min-w-0 truncate">{r.name}</span>
							{#if r.muted}<MicOff size={12} class="text-muted shrink-0" />{/if}
							{#if r.riding && !crew.bikes.some((b) => b.rider?.id === tag.id)}<Bike
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
	<div
		class="font-display pixel-words text-muted absolute bottom-0 left-0 flex max-w-full flex-wrap items-center gap-x-3 p-2 text-xs"
	>
		{#if onAir}<button
				type="button"
				onclick={() => radioHeard.set(!radioHeard.current)}
				aria-pressed={radioHeard.current}
				class="btn btn-ghost btn-xs px-0 {radioHeard.current ? 'text-ink' : ''}"
				><Disc3 size={13} />
				{radioHeard.current
					? 'Hearing house radio'
					: 'House radio muted here'}</button
			>
			<button
				type="button"
				onclick={crate}
				title="Pick house radio's style for everyone"
				aria-haspopup="menu"
				class="btn btn-ghost btn-xs text-ink px-0"
				>{pick === 'mix'
					? `Mix · ${STYLE_NAMES[styleNow]}`
					: PICK_NAMES[pick]}</button
			>
			<button
				type="button"
				onclick={next}
				title="Next track, for everyone"
				class="btn btn-ghost btn-xs text-ink px-0"
				><SkipForward size={13} /> Next</button
			>{:else}<button
				type="button"
				onclick={playRadio}
				title="Lofi made for your crew, for everyone here"
				class="btn btn-ghost btn-xs text-ink px-0"
				><Disc3 size={13} /> Play house radio</button
			>{/if}
		<button
			type="button"
			onclick={moods}
			title="Set the room's mood for everyone"
			aria-haspopup="menu"
			class="btn btn-ghost btn-xs text-ink px-0"
			><Sparkles size={13} />
			{mood ? MOODS[mood].name : 'Mood'}</button
		>
		<button
			type="button"
			onclick={() => (browsing = true)}
			title="Who has come by"
			class="btn btn-ghost btn-xs text-ink px-0"
			><BookOpen size={13} /> Album {album.length}/{VISITORS.length}</button
		>
		{#if onAir && nowPlaying}<span class="tabular-nums max-sm:hidden"
				>{nowPlaying}</span
			>{/if}
		{#if onAir && radioHeard.current && mixer.music === 0}<span
				>Music is at 0 in your mix.</span
			>{/if}
	</div>
	{#if browsing}<Album {album} onclose={() => (browsing = false)} />{/if}
	{#if dressing}<LookEditor onclose={() => (dressing = false)} />{/if}
</section>
