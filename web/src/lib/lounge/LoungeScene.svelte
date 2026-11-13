<script lang="ts">
	// The lounge (ADR-0094): the room a voice channel is while the cozy room
	// is on (#4305). The page decides when it shows (#4302); this draws it to
	// fill the page, at the biggest whole pixel the height allows, in the
	// rider's theme. Everyone in the call is in it, with their name and marks
	// hung under them here in the page. A screen too narrow for the room pans
	// across it. House radio is queued on the deck like a track and
	// HouseRadioDeck plays it.
	import { tick, untrack, type Snippet } from 'svelte';
	import { rideRoom } from '#lib/channel/ride-room.svelte.ts';
	import Disc3 from '@lucide/svelte/icons/disc-3';
	import SkipForward from '@lucide/svelte/icons/skip-forward';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Bike from '@lucide/svelte/icons/bike';
	import Drum from '@lucide/svelte/icons/drum';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import ScreenShare from '@lucide/svelte/icons/screen-share';
	import Video from '@lucide/svelte/icons/video';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import { useChannel } from '#lib/channel/context.ts';
	import { channelConnection } from '#lib/channel/connection.svelte.ts';
	import { playheadAt } from '#lib/channel/playhead.ts';
	import { awayState } from '#lib/away.ts';
	import {
		MENU_HINT,
		contextMenu,
		openMenu,
		type MenuEntry,
	} from '#lib/context-menu.svelte.ts';
	import { serverNow } from '#lib/server-clock.ts';
	import type { LoungeState } from '#lib/protocol.ts';
	import { goto } from '$app/navigation';
	import { sessionPath } from '#lib/channel/address.ts';
	import { device } from '#lib/device.svelte.ts';
	import { crewLive } from '#lib/nav/crew-live.svelte.ts';
	import { fetchPins } from '#lib/pins/pins.ts';
	import { presence } from '#lib/presence.svelte.ts';
	import { NO_MEMORY, fetchRoomMemory } from '#lib/lounge/memory.ts';
	import { mixer } from '#lib/sound/mixer.svelte.ts';
	import { prefersReducedMotion } from '#lib/motion/index.ts';
	import { fnv } from '#lib/world/loadout.ts';
	import { radioHeard } from '#lib/lounge/radio-heard.svelte.ts';
	import LookEditor from '#lib/lounge/LookEditor.svelte';
	import { sceneLoop } from '#lib/lounge/scene-loop.ts';
	import {
		KEY_NAMES,
		STYLE_NAMES,
		drumsIn,
		positionAt,
	} from '#lib/lounge/station.ts';
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
	} from '#lib/lounge/state.ts';
	import { recordAt } from '#lib/lounge/records.ts';
	import { cooled, crewOf } from '#lib/lounge/figures.ts';
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
	} from '#lib/lounge/moments.ts';
	import Album from '#lib/lounge/Album.svelte';
	import ArcadeGame from '#lib/lounge/ArcadeGame.svelte';
	import Furnish from '#lib/lounge/Furnish.svelte';
	import Logbook from '#lib/lounge/Logbook.svelte';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import Flame from '@lucide/svelte/icons/flame';
	import { levelFromXp } from '#lib/level.ts';
	import { play } from '#lib/sound/cues.ts';
	import { enter, exit } from '#lib/motion/transitions.ts';
	import {
		CHEER_SEC,
		cheerWords,
		cheersOf,
		type Cheer,
		type SeenStanding,
	} from '#lib/lounge/standing.ts';
	import Armchair from '@lucide/svelte/icons/armchair';
	import {
		VISITOR_NOTES,
		fetchAlbum,
		saveSighting,
		type Sighting,
	} from '#lib/lounge/album.ts';
	import { toasts } from '#lib/toast.svelte.ts';
	import type { LiveRider } from '#lib/channel/types.ts';
	import Beer from '@lucide/svelte/icons/beer';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
	import Goal from '@lucide/svelte/icons/goal';
	import { initialsOf } from '#lib/lounge/memory.ts';
	import type { Tab } from '#lib/lounge/arcade-pick.ts';
	import { play as playCue } from '#lib/sound/cues.ts';
	import Hand from '@lucide/svelte/icons/hand';
	import PartyPopper from '@lucide/svelte/icons/party-popper';
	import PersonStanding from '@lucide/svelte/icons/person-standing';
	import Shirt from '@lucide/svelte/icons/shirt';
	import Sofa from '@lucide/svelte/icons/sofa';
	import { palette } from '#lib/palette.svelte.ts';
	import { LOUNGE, applyLoungeTheme, skyAt } from '#lib/lounge/palette.ts';
	import { forgetWalls, shadeFor } from '#lib/lounge/draw-room.ts';
	import { forgetBackdrops } from '#lib/lounge/draw-window.ts';
	import { fitOf } from '#lib/lounge/fit.ts';
	import {
		SCENE_H,
		SCENE_W,
		ARCADE_SEAT,
		SPOT_HINTS,
		DOING_WORDS,
		placeAt,
		wallScreen,
		type Crew,
		type Doing,
		drawScene,
		hasFront,
		middleOf,
		spotAt,
		tagsOf,
		type Heart,
		type SceneInput,
	} from '#lib/lounge/scene.ts';

	let {
		menuOf,
		screen,
	}: {
		menuOf: (id: string) => MenuEntry[];
		/** What is shared: on the wall at this height, or at 0 above the room. */
		screen?: Snippet<[number]>;
	} = $props();

	/** The fewest rows a room at scale s draws: the stage, and under it the room's bar in page pixels. */
	const rowsAt = (s: number) => SCENE_H + Math.ceil(bar / s);
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
	let placeH = $state(0);
	/** The room's bar along its bottom, measured (on a phone it wraps to two lines), and its 4 px off the edge. */
	let barH = $state(0);
	const bar = $derived((barH || 24) + 4);
	// In whole pixels of the screen: at 125 % a room pixel of 3 would be
	// 3.75, and every fourth row a pixel short.
	let dpr = $state(1);
	// A picture on the wall takes the room a whole pixel down: the same floor,
	// and the rows that win grow the wall. Under 3 it would be under 200 px
	// tall, YouTube's floor, so it hangs above the room instead. Read from
	// the whole place, which a picture above the room does not change.
	const placeFit = $derived(fitOf(boxW, placeH, dpr, bar, false));
	const cinema = $derived(!!screen && placeFit >= 3);
	// Otherwise the whole room shows, its front row above the bar (fit.ts).
	const scale = $derived(
		cinema
			? Math.max(1, Math.round((placeFit - 1) * dpr)) / dpr
			: fitOf(boxW, boxH, dpr, bar),
	);
	const roomW = $derived(Math.max(SCENE_W, Math.floor(boxW / scale)));
	const roomH = $derived(
		Math.max(rowsAt(scale), Math.floor((cinema ? placeH : boxH) / scale)),
	);
	// Read by the frame on every tick, outside the effect that starts the loop.
	let size = { w: SCENE_W, h: SCENE_H + 32, cinema: false };
	$effect(() => {
		size = { w: roomW, h: roomH, cinema };
	});

	const crew = $derived(
		crewOf(channel.riders, 0, roomW, roomH, undefined, undefined, cinema),
	);
	const tags = $derived(tagsOf(crew, roomW, roomH, cinema));
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
	/** What the room remembers of the crew (memory.ts). */
	let memory = $state(NO_MEMORY);
	// Read again on a lobby ping: a pin pinned or a session ended elsewhere
	// reaches the wall without anyone reopening the room.
	$effect(() => {
		void presence.version;
		const crew = station;
		void fetchPins(crew).then((res) => {
			if (res.ok && crew === station) pins = res.data.length;
		});
		void fetchRoomMemory(crew).then((seen) => {
			if (crew === station) memory = seen;
		});
	});

	const crewName = $derived(
		crewLive.crews.find((c) => c.id === station)?.name ?? '',
	);
	let furnishing = $state(false);

	/** Bergpreis: you go and stand at the cabinet, and come back after. */
	let gaming = $state(false);
	let arcadeTab = $state<Tab | undefined>();
	let seatBefore = 0;
	/** Töggeli: the match at the table, and challenges to or from you. */
	const youId = $derived(channel.riders.find((r) => r.you)?.id);
	const table = $derived(live?.table ?? null);
	const invites = $derived(live?.invites ?? []);
	const challenged = $derived(invites.find((i) => i.to === youId));
	const others = $derived(
		channel.riders
			.filter((r) => !r.you)
			.map((r) => ({ id: r.id, name: r.name })),
	);
	// A challenge to you gets a sound as well as the banner.
	let heardInvite = '';
	$effect(() => {
		const key = challenged ? `${challenged.from}:${challenged.until}` : '';
		untrack(() => {
			if (key && key !== heardInvite) playCue('poke');
			heardInvite = key;
		});
	});
	/** The cabinet's games as the logbook lists your bests. */
	const GAMES_LISTED = [
		['bergpreis', 'Bergpreis'],
		['feedzone', 'Feed zone'],
		['darts', 'Darts'],
		['toeggeli', 'Töggeli'],
	] as const;
	/** What the km stone says, on a hover and a tap. */
	const stoneSays = $derived(
		memory.boardMetres > 0
			? `${Math.round(memory.boardMetres / 1000).toLocaleString('de-CH')} km ridden in this crew's sessions, by the riders on its weekly board.`
			: 'The km stone counts km ridden in this crew’s sessions by riders on its weekly board. Switch “include me” on under Members to count yours.',
	);
	function openToeggeli() {
		arcadeTab = 'toeggeli';
		playGame();
	}
	function playGame() {
		arcadeUntil = clock + 8;
		seatBefore = channel.riders.find((r) => r.you)?.seat ?? 0;
		live?.room({ seat: ARCADE_SEAT });
		gaming = true;
	}
	function leaveGame() {
		gaming = false;
		arcadeTab = undefined;
		live?.room({ seat: seatBefore });
	}

	/** Read the room's memory again: a new score or rug shows at once. */
	const reread = () => {
		const crew = station;
		void fetchRoomMemory(crew).then((seen) => {
			if (crew === station) memory = seen;
		});
	};

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

	/** Your logbook is open: you tapped the book on the desk. */
	let reading = $state(false);

	/**
	 * Who is celebrating a level or a week of rider streak, and since when on
	 * the scene's clock (standing.ts). The roster's numbers move when a ride
	 * saves; what this room saw first never celebrates.
	 */
	let cheering = $state<{ cheer: Cheer; at: number }[]>([]);
	const standingSeen: SeenStanding = new Map();
	$effect(() => {
		const riders = channel.riders;
		untrack(() => {
			const fresh = cheersOf(standingSeen, riders);
			if (!fresh.length) return;
			const ids = new Set(fresh.map((c) => c.id));
			cheering = [
				...cheering.filter((c) => !ids.has(c.cheer.id)),
				...fresh.map((cheer) => ({ cheer, at: clock })),
			];
			play(fresh.some((c) => c.level !== undefined) ? 'fanfare' : 'summit');
		});
	});
	/** Who dances right now: a cheer of theirs, unless they are doing something else. */
	const dancing = (riders: LiveRider[]) =>
		cheering.length
			? riders.map((r) =>
					!r.emote && cheering.some((c) => c.cheer.id === r.id)
						? { ...r, emote: 'dance' }
						: r,
				)
			: riders;

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
		if (cheering.some((c) => clock - c.at >= CHEER_SEC))
			cheering = cheering.filter((c) => clock - c.at < CHEER_SEC);
		const drawn = crewOf(
			dancing(riders),
			still ? 0 : clock,
			size.w,
			size.h,
			new Set(coolingUntil.keys()),
			{ sec, music: !!deck?.playing },
		);
		watchHearts(riders);
		noteDoing(drawn, sec);
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
			crew: drawn,
			...music(),
			...(mood === 'arcade' && { disco: true }),
			fire,
			cat: catAt(seed, sec),
			catAwake: clock < catAwakeUntil,
			hearts,
			cheers: cheering.flatMap(({ cheer, at }) => {
				const tag = tags.find((t) => t.id === cheer.id);
				return tag ? [{ x: tag.x, y: tag.head, born: at }] : [];
			}),
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
				initial: (crewName[0] ?? 'W').toUpperCase(),
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

	/** What you can do in the room, on your own figure. */
	const EMOTES = [
		{ emote: 'wave', label: 'Wave', icon: Hand },
		{ emote: 'dance', label: 'Dance', icon: PartyPopper },
		{ emote: 'cheers', label: 'Cheers', icon: Beer },
		{ emote: 'stretch', label: 'Stretch', icon: PersonStanding },
	];

	/** You: your look and what you can do. Anyone else: a heart everyone sees. */
	function touch(
		tag: { id: string; x: number; head: number },
		e: MouseEvent & { currentTarget: HTMLElement },
	) {
		const you = byId.get(tag.id);
		if (!you?.you) {
			live?.room({ emote: 'heart', to: tag.id });
			return;
		}
		openMenu(
			[
				{
					label: 'Change your look',
					icon: Shirt,
					onSelect: () => (dressing = true),
				},
				{
					label: 'Your logbook',
					icon: NotebookPen,
					onSelect: () => (reading = true),
				},
				...EMOTES.map(({ emote, label, icon }) => ({
					label,
					icon,
					onSelect: () => live?.room({ emote }),
				})),
				...(you.seat
					? [
							{
								label: 'Sit anywhere',
								icon: Sofa,
								onSelect: () => live?.room({ seat: 0 }),
							},
						]
					: []),
			],
			e.clientX,
			e.clientY,
			e.currentTarget,
		);
	}

	// A heart is the channel's: the roster carries each one once, by its count.
	const heartsSeen = new Map<string, number>();
	function watchHearts(riders: LiveRider[]) {
		for (const r of riders) {
			const seq = r.emoteSeq ?? 0;
			const was = heartsSeen.get(r.id);
			heartsSeen.set(r.id, seq);
			if (was === undefined || seq <= was || r.emote !== 'heart') continue;
			const to = tags.find((t) => t.id === r.emoteTo);
			if (to) heart(to.x - 2, to.head - 8);
		}
	}

	/** Who is doing what, in words, refreshed every couple of seconds. */
	let doingOf = $state<Record<string, Doing>>({});
	let doingAt = -Infinity;
	function noteDoing(crew: Crew, sec: number) {
		if (sec - doingAt < 2) return;
		doingAt = sec;
		const all = [
			...crew.seated,
			...crew.floor.map((p) => p.f),
			...crew.placed.map((p) => p.f),
		];
		doingOf = Object.fromEntries(
			all.flatMap((f) => (f ? [[f.id, f.doing ?? '']] : [])),
		);
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
		const { ox, oy } = middleOf(roomW, roomH, cinema);
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
		const { ox, oy } = middleOf(roomW, roomH, cinema);
		const cat = catAt(seed, serverNow() / 1000);
		return {
			who: tags.find(
				(t) => Math.abs(x - t.x) <= 7 && y >= t.head - 2 && y <= t.y,
			),
			cat:
				Math.abs(x - ox - cat.x) <= 11 &&
				y - oy <= cat.y + 1 &&
				y - oy >= cat.y - 20,
			spot: spotAt(x - ox, y - oy, hasFront(roomW, roomH, cinema)),
			seat: placeAt(x - ox, y - oy, hasFront(roomW, roomH, cinema)),
		};
	}

	function click(e: MouseEvent) {
		const { who, cat, spot, seat } = at(e);
		// A flip by hand leaves the mood: the room is no longer its preset.
		const state = { ...lounge, weather: weatherOf(lounge), mood: '' };
		if (who) touch(who, e as MouseEvent & { currentTarget: HTMLElement });
		else if (seat) live?.room({ seat });
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
		else if (spot === 'arcade') playGame();
		else if (spot === 'board') void goto(`/crew/${station}/schedule`);
		else if (spot === 'cork') void goto(`/crew/${station}`);
		else if (spot === 'logbook') reading = true;
		else if (spot === 'stone') toasts.push(stoneSays);
		else if (spot === 'laptop' && running)
			void goto(sessionPath(station, running.id));
		else if (spot === 'bike' && rideRoom.on) rideRoom.on = false;
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
	const crate = (e: MouseEvent & { currentTarget: HTMLElement }) =>
		crateAt(e.currentTarget);
	function crateAt(anchor: HTMLElement) {
		const box = anchor.getBoundingClientRect();
		openMenu(
			RADIO_PICKS.map((p) => ({
				label: PICK_NAMES[p],
				icon: Disc3,
				hint: p === pick ? 'on' : undefined,
				onSelect: () => p !== pick && retune({ radioStyle: p }),
			})),
			box.left,
			box.top,
			anchor,
		);
	}

	/** One tap sets the window, lamp, stove and radio for everyone. */
	function more(e: MouseEvent & { currentTarget: HTMLElement }) {
		const anchor = e.currentTarget;
		const box = anchor.getBoundingClientRect();
		openMenu(
			[
				...(onAir
					? [
							{
								label: 'Radio style',
								icon: Disc3,
								hint: PICK_NAMES[pick],
								onSelect: () => crateAt(anchor),
							},
							{ label: 'Next track', icon: SkipForward, onSelect: next },
						]
					: []),
				{
					label: 'Furnish',
					icon: Armchair,
					onSelect: () => (furnishing = true),
				},
				{
					label: 'Album',
					icon: BookOpen,
					hint: `${album.length}/${VISITORS.length}`,
					onSelect: () => (browsing = true),
				},
				{ label: 'Arcade', icon: Gamepad2, onSelect: playGame },
			],
			box.left,
			box.top,
			anchor,
		);
	}
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
			r.totalXp !== undefined && `level ${levelFromXp(r.totalXp)}`,
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

<svelte:window onkeydown={key} bind:devicePixelRatio={dpr} />

<div class="flex min-h-0 flex-1 flex-col" bind:clientHeight={placeH}>
	{#if screen && !cinema}
		<div class="shrink-0 px-2 pt-2">{@render screen(0)}</div>
	{/if}
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
			<div
				class="relative h-full"
				style:width="{roomW * scale}px"
				style:margin-left="{Math.floor(
					(Math.max(0, boxW - roomW * scale) / 2) * dpr,
				) / dpr}px"
			>
				<canvas
					bind:this={canvas}
					width={roomW}
					height={roomH}
					onclick={click}
					onmousemove={(e) => {
						const over = at(e);
						canvas!.style.cursor =
							over.who || over.cat || over.spot || over.seat
								? 'pointer'
								: 'default';
						canvas!.title = over.who
							? ''
							: over.seat
								? 'Sit here'
								: over.cat
									? 'Pet the cat'
									: over.spot === 'stone'
										? stoneSays
										: over.spot
											? SPOT_HINTS[over.spot]
											: '';
					}}
					class="absolute bottom-0 left-0 block [image-rendering:pixelated]"
					style:width="{roomW * scale}px"
					style:height="{roomH * scale}px"
					aria-label="The lounge: who is in the call, on the sofa, the cushions or a trainer. Click someone to send a heart, yourself to change your look or read your logbook, or the cat, the lamp, the window, the stove, the clock, the goldfish or the plant. The record player plays the next track for everyone."
				></canvas>
				{#if cinema && screen}
					{@const cloth = wallScreen(roomW, roomH)}
					<div
						class="absolute"
						data-testid="wall-screen"
						style:left="{cloth.x * scale}px"
						style:top="{top + cloth.y * scale}px"
						style:width="{cloth.w * scale}px"
						style:height="{cloth.h * scale}px"
					>
						{@render screen(cloth.h * scale)}
					</div>
				{/if}
				<div role="group" aria-label="in the call">
					{#each tags as tag (tag.id)}
						{@const r = byId.get(tag.id)}
						{#if r}
							{@const Away = awayState(r.awayReason).icon}
							<button
								type="button"
								{@attach contextMenu(() => menuOf(tag.id))}
								onclick={(e) => touch(tag, e)}
								title={r.you
									? 'You: your look, a wave, a dance'
									: `${r.name}, ${DOING_WORDS[doingOf[r.id] ?? '']}. Send a heart · ${MENU_HINT}`}
								aria-label={described(tag.id)}
								class="font-display pixel-words absolute flex -translate-x-1/2 items-center gap-1 leading-none font-semibold whitespace-nowrap {scale >=
								4
									? 'text-sm'
									: scale >= 3
										? 'text-xs'
										: 'text-[11px]'} {r.away ? 'text-muted' : 'text-ink'} {r.you
									? 'decoration-neon underline decoration-2 underline-offset-2'
									: ''}"
								style:left="{tag.x * scale}px"
								style:top="{top + tag.y * scale}px"
								style:max-width="{Math.max(56, tag.span * scale)}px"
							>
								{#if r.away}<Away size={12} class="text-muted shrink-0" />{/if}
								{#if r.totalXp !== undefined}<span
										class="bg-neon text-on-neon shrink-0 rounded-sm px-1 py-px tabular-nums"
										>{levelFromXp(r.totalXp)}</span
									>{/if}
								<span class="min-w-0 truncate">{r.name}</span>
								{#if r.muted}<MicOff
										size={12}
										class="text-muted shrink-0"
									/>{/if}
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
				<!-- A level or a week of streak gained, over the rider's head for
				     everyone here (standing.ts), and said aloud to a screen reader. -->
				<div role="status" aria-live="polite">
					{#each cheering as { cheer } (cheer.id)}
						{@const tag = tags.find((t) => t.id === cheer.id)}
						{@const r = byId.get(cheer.id)}
						{#if tag && r}
							{@const Mark = cheer.level === undefined ? Flame : PartyPopper}
							<p
								in:enter={{ y: 8 }}
								out:exit={{ y: -8 }}
								class="font-display bg-neon text-on-neon pointer-events-none absolute flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded px-2 py-1 leading-none font-bold whitespace-nowrap {scale >=
								4
									? 'text-base'
									: 'text-sm'}"
								style:left="{tag.x * scale}px"
								style:top="{top + (tag.head - 12) * scale}px"
							>
								<Mark size={14} aria-hidden="true" />
								<span class="sr-only">{r.name}:</span>
								{cheerWords(cheer)}
							</p>
						{/if}
					{/each}
				</div>
			</div>
		</div>
		<div
			bind:clientHeight={barH}
			class="font-display pixel-words text-muted bg-surface/85 absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-x-3 rounded px-2 py-0.5 text-xs"
		>
			{#if onAir}<button
					type="button"
					onclick={() => radioHeard.set(!radioHeard.current)}
					aria-pressed={radioHeard.current}
					class="btn btn-ghost btn-xs px-0 max-sm:min-h-11 max-sm:px-2 {radioHeard.current
						? 'text-ink'
						: ''}"
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
					class="btn btn-ghost btn-xs text-ink px-0 max-sm:hidden max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
					>{pick === 'mix'
						? `Mix · ${STYLE_NAMES[styleNow]}`
						: PICK_NAMES[pick]}</button
				>
				<button
					type="button"
					onclick={next}
					title="Next track, for everyone"
					class="btn btn-ghost btn-xs text-ink px-0 max-sm:hidden max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
					><SkipForward size={13} /> Next</button
				>{:else}<button
					type="button"
					onclick={playRadio}
					title="Lofi made for your crew, for everyone here"
					class="btn btn-ghost btn-xs text-ink px-0 max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
					><Disc3 size={13} /> Play house radio</button
				>{/if}
			<button
				type="button"
				onclick={moods}
				title="Set the lounge's mood for everyone"
				aria-haspopup="menu"
				class="btn btn-ghost btn-xs text-ink px-0 max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
				><Sparkles size={13} />
				{mood ? MOODS[mood].name : 'Mood'}</button
			>
			<button
				type="button"
				onclick={() => (furnishing = true)}
				title="Furnish the lounge with your Batzen"
				class="btn btn-ghost btn-xs text-ink px-0 max-sm:hidden max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
				><Armchair size={13} /> Furnish</button
			>
			<button
				type="button"
				onclick={() => (browsing = true)}
				title="Who has come by"
				class="btn btn-ghost btn-xs text-ink px-0 max-sm:hidden max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
				><BookOpen size={13} /> Album {album.length}/{VISITORS.length}</button
			>
			<button
				type="button"
				onclick={playGame}
				title="The arcade: three games, Töggeli and your crew's high scores"
				class="btn btn-ghost btn-xs text-ink px-0 max-sm:hidden max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
				><Gamepad2 size={13} /> Arcade</button
			>
			<!-- A phone keeps the tools on one row of full-size buttons: the
			     radio's style and Next, and the three opened least, go under
			     More (#4569). -->
			<button
				type="button"
				onclick={more}
				aria-label="More in the lounge"
				aria-haspopup="menu"
				class="btn btn-ghost text-ink min-h-11 min-w-11 px-2 sm:hidden"
				><Ellipsis size={16} /></button
			>
			{#if table}<button
					type="button"
					onclick={openToeggeli}
					title="Watch the match at the table"
					class="btn btn-ghost btn-xs text-ink px-0 tabular-nums max-sm:min-h-11 max-sm:min-w-11 max-sm:px-2"
					><Goal size={13} /> Töggeli · {initialsOf(table.leftName)}
					{table.leftGoals}:{table.rightGoals}
					{initialsOf(table.rightName)}</button
				>{/if}
			{#if onAir && nowPlaying}<span class="tabular-nums max-sm:hidden"
					>{nowPlaying}</span
				>{/if}
			{#if onAir && radioHeard.current && mixer.music === 0}<span
					>Music is at 0 in your mix.</span
				>{/if}
		</div>
		{#if furnishing}<Furnish
				crew={station}
				owned={memory.owned}
				picks={memory.picks}
				shop={memory.shop}
				togetherSec={memory.togetherSec}
				onclose={() => (furnishing = false)}
				onchange={reread}
			/>{/if}
		{#if challenged && !gaming && !table}
			<div
				class="bg-surface/90 absolute top-2 left-1/2 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded px-3 py-2 text-sm shadow"
				role="status"
			>
				<Goal size={16} />
				<span
					><span class="font-semibold">{challenged.fromName}</span> challenges you
					to Töggeli</span
				>
				<button
					type="button"
					class="btn btn-primary btn-xs"
					onclick={() => {
						live?.toeggeli({ op: 'accept', to: challenged.from });
						openToeggeli();
					}}>Play</button
				>
				<button
					type="button"
					class="btn btn-ghost btn-xs"
					onclick={() => live?.toeggeli({ op: 'decline', to: challenged.from })}
					>Not now</button
				>
			</div>
		{/if}
		{#if gaming}<ArcadeGame
				crew={station}
				open={arcadeTab}
				{table}
				{invites}
				riders={others}
				onToeggeli={(cmd) => live?.toeggeli(cmd)}
				you={channel.riders.find((r) => r.you)?.id}
				onclose={leaveGame}
				onscore={reread}
			/>{/if}
		{#if browsing}<Album {album} onclose={() => (browsing = false)} />{/if}
		{#if dressing}<LookEditor onclose={() => (dressing = false)} />{/if}
		{#if reading}<Logbook onclose={() => (reading = false)}>
				{#snippet arcade()}
					<ul class="grid gap-1 text-sm">
						{#each GAMES_LISTED as [id, name] (id)}
							<li class="flex justify-between gap-3">
								<span>{name}</span>
								<span class="font-display tabular-nums"
									>{memory.bests[id]
										? `${memory.bests[id]}${id === 'toeggeli' ? ' wins' : ''}`
										: 'not yet'}</span
								>
							</li>
						{/each}
					</ul>
				{/snippet}
			</Logbook>{/if}
	</section>
</div>
