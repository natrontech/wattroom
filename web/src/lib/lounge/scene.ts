/**
 * The lounge as one frame (ADR-0094), seen from above at an angle: the back
 * wall with the window, the sofa under it, the crew around one rug and
 * table, a trainer for everyone who rides. What the picture needs to know,
 * where its clickable things sit, and the order it is painted in.
 */
import type { Ctx } from '$lib/lounge/pixel';
import type { RadioPick, Weather } from '$lib/lounge/state';
import type { Sky } from '$lib/lounge/palette';
import {
	drawBack,
	drawLive,
	drawScreen,
	drawShade,
} from '$lib/lounge/draw-room';
import { drawWindow } from '$lib/lounge/draw-window';
import {
	drawFloorCrew,
	drawHearts,
	drawSofaCrew,
} from '$lib/lounge/draw-people';
import { drawCat } from '$lib/lounge/draw-cat';
import { drawDisco } from '$lib/lounge/draw-disco';
import { drawLights } from '$lib/lounge/draw-sides';
import { drawCheers, drawConfetti } from '$lib/lounge/draw-moments';
import { drawFloorVisitor } from '$lib/lounge/draw-visitors';
import type { Cat, Flyby, Moment, Season, Visitor } from '$lib/lounge/moments';

/**
 * The stage: the room's middle, where everything you can click sits, at
 * 16:9 so whole multiples of it are the screen sizes (640 × 360 … 1920 ×
 * 1080). A bigger page shows more room around it.
 */
export const SCENE_W = 320;
export const SCENE_H = 180;
/** What of the stage must show: everything clickable and everyone on the sofa is inside it. */
export const SAFE_W = 296;
/** The first row of floor; the back wall stands above it. */
export const FLOOR_Y = 80;
/** The sofa's seats: their centres, and the row a sitter's seat is on. */
export const SEAT_XS = [125, 148, 171, 194];
export const SEAT_BASE = 75;
export const SEATS = SEAT_XS.length;
/** A floor spot's grid: rows this far apart, so a name fits under each figure. */
export const SPOT_DX = 26;
export const SPOT_DY = 26;
/** The trainers' columns either side of the rug, and the rows they stand on. */
export const BIKE_XS = [236, 84] as const;
/** The km stone's left edge and its foot, on the floor left of the bikes. */
export const STONE_X = 30;
export const STONE_Y = 136;
export const BIKE_GROUND = 135;
export const BIKE_DY = 58;
/** The two trainers that stand in the room whether or not anyone rides. */
export const BIKES_ALWAYS = 2;
/** The row the front of a tall room's things stand on: a beanbag, a plant, the arcade. */
export const FRONT_Y = 248;

/** Someone in the voice channel, as the scene dresses them. */
export interface Figure {
	id: string;
	name: string;
	skin: string;
	skinShade: string;
	hair: string;
	/** look.ts's HAIR_NAMES: short, long, a bun, a beanie, a mohawk, curls, a ponytail, bald and on. */
	hairStyle: number;
	shirt: string;
	shirtShade: string;
	/** look.ts's TOPS: a tee, a hoodie, a jersey, a sweater, a vest, a rain jacket; and whether it is striped. */
	top: number;
	stripes: boolean;
	pants: string;
	pantsShade: string;
	shoes: string;
	/** look.ts's GLASSES: none, round, shades. */
	glasses: number;
	/** The cap's, the scarf's and the socks' colours, when they wear them. */
	cap?: string;
	scarf?: string;
	socks?: string;
	/** look.ts's BEARDS, BADGES and PETS: 0 is none. */
	beard?: number;
	badge?: number;
	pet?: number;
	/** The cushion they sit on when the sofa is full. */
	cushion: string;
	speaking: boolean;
	/** Headphones on: in the call with their mic off. */
	muted: boolean;
	/** Their away reason ('' for plain away), or undefined while here. */
	away?: string;
	/** A soundboard clip of theirs is playing here. */
	sounding: boolean;
	/** Heard, with no live link: drawn in one lilac until it redials. */
	faded: boolean;
	/** Just off the bike: a towel round the neck and a bottle in hand. */
	cooling?: boolean;
	/** The place they took (PLACES, or the sofa's 1 to 4); absent is wherever. */
	seat?: number;
	/** What they are doing for a moment, from the hub's LoungeEmotes. */
	emote?: string;
	/** What they are up to otherwise. */
	doing?: Doing;
}

/** What someone in the room is up to: their place's, or an idle one. */
export type Doing =
	| ''
	| 'sip'
	| 'read'
	| 'phone'
	| 'nap'
	| 'nod'
	| 'stretch'
	| 'type'
	| 'warm'
	| 'lounge'
	| 'coffee'
	| 'play'
	| 'wrench';

/** The same, in words, for the name that a pointer finds. */
export const DOING_WORDS: Record<Doing, string> = {
	'': 'hanging out',
	sip: 'having a coffee',
	read: 'reading',
	phone: 'on their phone',
	nap: 'having a nap',
	nod: 'nodding along',
	stretch: 'stretching',
	type: 'at the laptop',
	warm: 'warming up by the stove',
	lounge: 'on the beanbag',
	coffee: 'at the coffee bar',
	play: 'at the arcade',
	wrench: 'fixing a bike',
};

/** A place in the room to take, past the sofa: its seat, where, and what it is for. */
export interface Place {
	seat: number;
	x: number;
	y: number;
	doing: Doing;
	/** Only a tall room has it. */
	front?: boolean;
	/** The floor a click takes it from: x, y, width, height. */
	hit: readonly [number, number, number, number];
}

/** The place at the arcade cabinet: where you stand while you play. */
export const ARCADE_SEAT = 11;

export const PLACES: readonly Place[] = [
	{ seat: 5, x: 58, y: 96, doing: 'type', hit: [44, 86, 28, 16] },
	{ seat: 6, x: 203, y: 104, doing: 'warm', hit: [190, 92, 26, 18] },
	{
		seat: 7,
		x: 104,
		y: FRONT_Y - 2,
		doing: 'lounge',
		front: true,
		hit: [90, FRONT_Y - 16, 28, 18],
	},
	{
		seat: 8,
		x: 146,
		y: FRONT_Y - 2,
		doing: 'lounge',
		front: true,
		hit: [132, FRONT_Y - 16, 28, 18],
	},
	{
		seat: 9,
		x: 266,
		y: FRONT_Y + 12,
		doing: 'coffee',
		front: true,
		hit: [256, FRONT_Y + 2, 20, 14],
	},
	{
		seat: 10,
		x: 296,
		y: FRONT_Y + 12,
		doing: 'coffee',
		front: true,
		hit: [286, FRONT_Y + 2, 20, 14],
	},
	{
		seat: 11,
		x: 233,
		y: FRONT_Y + 14,
		doing: 'play',
		front: true,
		hit: [221, FRONT_Y + 2, 24, 16],
	},
	{
		seat: 12,
		x: 40,
		y: FRONT_Y + 10,
		doing: 'wrench',
		front: true,
		hit: [24, FRONT_Y + 2, 36, 14],
	},
];

/** Which place a click at the stage's coordinates takes: a seat number, or 0. */
export function placeAt(x: number, y: number, front = false): number {
	if (y >= SEAT_BASE - 16 && y < SEAT_BASE + 11) {
		const seat = SEAT_XS.findIndex((sx) => Math.abs(x - sx) <= 10);
		if (seat >= 0) return seat + 1;
	}
	const place = PLACES.find(
		({ hit: [hx, hy, hw, hh], front: tall }) =>
			(!tall || front) && x >= hx && x < hx + hw && y >= hy && y < hy + hh,
	);
	return place?.seat ?? 0;
}

export interface Rider extends Figure {
	watts: number;
	/** Where the cranks are, in radians, turned at the rider's cadence. */
	crank: number;
}

/** A place on the floor, in the stage's coordinates: a figure's centre and the row it sits on. */
export interface Spot {
	x: number;
	y: number;
}

/** A trainer: where it stands, which way it faces, and who rides it. */
export interface Bike extends Spot {
	/** 1 faces right, -1 left: always toward the rug. */
	face: 1 | -1;
	rider?: Rider;
}

/** Everyone in the call, placed (figures.ts). */
export interface Crew {
	/** Every trainer drawn: the two that always stand there, and one more for each rider past them. */
	bikes: Bike[];
	/** The sofa, seat by seat: null is a seat nobody took, ahead of one somebody did. */
	seated: (Figure | null)[];
	floor: ({ f: Figure } & Spot)[];
	/** Who took a place of their own (PLACES). */
	placed: ({ f: Figure } & Spot)[];
	/** In the call with no spot left: counted beside the last one. */
	more: number;
}

/** A heart rising from whoever was clicked, in room pixels. */
export interface Heart {
	x: number;
	y: number;
	born: number;
}

/** The crew's life, as the room's objects show it. */
export interface Club {
	/** The chalkboard: the next plan's day and time, when there is one. */
	plan?: { day: string; time: string };
	/** Notes on the corkboard: the crew's pins. */
	pins: number;
	/** Riders on the crew's running session; the laptop shows it live. */
	live: number;
	/** Sessions ridden together: the plant grows with them. */
	sessions: number;
	/** Medals on the wall. */
	medals: number;
	/** How many rode each of the last sessions: a polaroid each. */
	polaroids: number[];
	/** What is up in each slot (furnish.ts); absent is the room as it came. */
	picks: Record<string, string>;
	/** The crew's name's first letter, for the neon sign. */
	initial: string;
	/** Each game's record, on the cabinet's screen in turn. */
	records: ArcadeRecord[];
	/** Riders who hold a game's record: they wear a crown. */
	crowns: string[];
	/** The crew's time together in voice: the room wears in with it. */
	togetherSec: number;
	/** The km stone's metres: crew sessions, the weekly board's riders only. */
	boardMetres: number;
}

/** A game's record as the cabinet shows it: the holder's initials and the score. */
export interface ArcadeRecord {
	initials: string;
	score: number;
}

export interface SceneInput {
	/** The whole room in scene pixels, never smaller than the stage. */
	w: number;
	h: number;
	/** A picture is on the wall: the wall takes every spare row (wallScreen). */
	cinema?: boolean;
	/** Seconds on the scene's own clock; motion holds still under reduced motion. */
	t: number;
	still: boolean;
	sky: Sky;
	weather: Weather;
	lampOn: boolean;
	crew: Crew;
	/** Whether something plays: the platter turns and its light is on. */
	playing: boolean;
	/** Beats on the music's clock, and whether there is a beat to follow. */
	beat: number;
	pulsing: boolean;
	/** The ball is down: the radio is in a drop (moments.ts). */
	disco: boolean;
	cat: Cat;
	/** Someone in the channel just petted it. */
	catAwake: boolean;
	hearts: Heart[];
	/** Riders celebrating a level or a streak: their heads, and since when (standing.ts). */
	cheers?: Heart[];
	/** The viewer's own time, for the wall clock. */
	hours: number;
	minutes: number;
	cuckoo: boolean;
	/** How dark the room is, eased so the lamp never flashes it. */
	shade: number;
	flyby?: Flyby;
	/** The cat knocked the mug off the desk. */
	mugDown: boolean;
	/** Someone scratched the record. */
	scratch: boolean;
	season: Season;
	/** When the crew last did the wave, on the scene's clock. */
	waveAt: number;
	/** House radio's picked style, '' for records: the record's label shows it. */
	radio: RadioPick;
	/** The goldfish was tapped and is jumping. */
	fishJump: boolean;
	/** The plant was touched and is in flower. */
	bloom: boolean;
	/** The arcade cabinet was tapped and is playing its race. */
	arcade: boolean;
	/** The stove is lit: flames in its window, a warm glow over the room. */
	fire: boolean;
	/** Friday from five: a pizza on the table (moments.ts). */
	pizza: boolean;
	/** The same evening in winter: fondue instead. */
	fondue: boolean;
	/** What the calendar brings today (moments.ts). */
	moment: Moment;
	/** What the crew's own things on the wall show. */
	club: Club;
	/** A rare visitor passing through (moments.ts). */
	visitor?: { kind: Visitor; f: number };
	/** Past midnight: an owl on the sill. */
	owl: boolean;
}

/** How hard things move on this beat: a kick's fall-off, or a slow idle. */
export function pulseOf(input: SceneInput): number {
	if (input.still) return 0.8;
	if (!input.pulsing) return 0.75 + 0.1 * Math.sin(input.t);
	const f = input.beat - Math.floor(input.beat);
	return Math.exp(-f * 5);
}

/**
 * Where the stage sits in a room of w × h: centred across, and in a tall
 * room (a phone) lowered a little, so the wall grows above it as well as
 * the floor below.
 */
export function middleOf(w: number, h: number, cinema = false) {
	return {
		ox: Math.floor((w - SCENE_W) / 2),
		oy: cinema
			? Math.max(0, h - SCENE_H)
			: Math.max(0, Math.min(48, Math.floor((h - 210) / 3))),
	};
}

/** Whether a room is tall enough for its front row: the beanbag, the plant and the arcade. */
export function hasFront(w: number, h: number, cinema = false): boolean {
	return !cinema && h - middleOf(w, h).oy >= FRONT_Y + 14;
}

/** The first row a sitter's head can reach: a screen on the wall stops above it. */
const SCREEN_FOOT = 52;
/** How far the screen hangs under the ceiling, clear of the bulbs. */
const SCREEN_TOP = 10;

/**
 * The projector screen, in room pixels: 16:9, in the middle, from under the
 * bulbs to just above the sofa. A picture on the wall gives the room this:
 * the floor stays, the wall grows up to the ceiling, and the window goes
 * behind the screen.
 */
export function wallScreen(w: number, h: number) {
	const { oy } = middleOf(w, h, true);
	const foot = oy + SCREEN_FOOT;
	const cols = Math.min(w - 24, Math.round(((foot - SCREEN_TOP) * 16) / 9));
	const rows = Math.round((cols * 9) / 16);
	return { x: Math.floor((w - cols) / 2), y: foot - rows, w: cols, h: rows };
}

export function drawScene(g: Ctx, input: SceneInput) {
	const { ox, oy } = middleOf(input.w, input.h, input.cinema);
	drawBack(g, input, ox, oy);
	g.save();
	g.translate(ox, oy);
	drawWindow(g, input);
	drawLive(g, input);
	if (input.cinema) {
		g.save();
		g.translate(-ox, -oy);
		drawScreen(g, wallScreen(input.w, input.h));
		g.restore();
	}
	drawSofaCrew(g, input);
	// Behind everyone on the floor: its lane and spots are all further back
	// than the first row, so a rider sits in front of it, never under it.
	drawCat(g, input);
	drawFloorVisitor(g, input);
	drawFloorCrew(g, input);
	g.restore();
	drawLights(g, input);
	drawConfetti(g, input);
	drawHearts(g, input);
	drawCheers(g, input);
	drawShade(g, input, ox, oy);
	drawDisco(g, input);
}

/** Where a name hangs under someone, and where their head is, in room pixels. */
export interface Tag {
	id: string;
	x: number;
	/** The name's top row. */
	y: number;
	head: number;
	/** How wide their name may be. */
	span: number;
}

export function tagsOf(
	crew: Crew,
	w: number,
	h: number,
	cinema = false,
): Tag[] {
	const { ox, oy } = middleOf(w, h, cinema);
	// Every other name on the sofa a row lower, so neighbours get twice the width.
	const tags: Tag[] = crew.seated.flatMap((f, i) =>
		f
			? [
					{
						id: f.id,
						x: ox + SEAT_XS[i],
						y: oy + 89 + (i % 2) * 7,
						head: oy + SEAT_BASE - 19,
						span: (SEAT_XS[1] - SEAT_XS[0]) * 2,
					},
				]
			: [],
	);
	for (const { rider, x, y } of crew.bikes)
		if (rider)
			tags.push({
				id: rider.id,
				x: ox + x,
				y: oy + y + 4,
				head: oy + y - 31,
				span: 40,
			});
	for (const { f, x, y } of [...crew.floor, ...crew.placed])
		tags.push({
			id: f.id,
			x: ox + x,
			y: oy + y + 4,
			head: oy + y - 19,
			span: SPOT_DX,
		});
	return tags;
}

export type Hotspot =
	| 'lamp'
	| 'deck'
	| 'window'
	| 'clock'
	| 'stove'
	| 'fish'
	| 'plant'
	| 'arcade'
	| 'board'
	| 'cork'
	| 'laptop'
	| 'logbook'
	| 'bike'
	| 'stone';

/** What each clickable thing does, for the pointer that finds it. */
export const SPOT_HINTS: Record<Hotspot, string> = {
	lamp: 'Turn the lamp on or off, for everyone',
	deck: 'The record player: play or skip, for everyone',
	window: 'Change the weather, for everyone',
	clock: 'The cuckoo clock',
	stove: 'Light the stove, for everyone',
	fish: 'The goldfish',
	plant: 'The plant grows with every session you ride together',
	arcade: 'Bergpreis: thirty seconds up the hill',
	board: 'The next ride: open the Schedule',
	cork: 'Your crew’s pins and last sessions',
	laptop: 'A running session: go and join it',
	logbook: 'Your logbook: your level, streak and hours, for you alone',
	bike: 'Start riding',
	stone: 'The km your crew rode together, by the riders on its weekly board',
};

const SPOTS: { spot: Hotspot; x: number; y: number; w: number; h: number }[] = [
	{ spot: 'logbook', x: 28, y: 52, w: 15, h: 10 },
	{ spot: 'clock', x: 216, y: 10, w: 22, h: 38 },
	{ spot: 'stove', x: 216, y: 48, w: 20, h: 38 },
	{ spot: 'lamp', x: 80, y: 34, w: 18, h: 28 },
	{ spot: 'fish', x: 268, y: 46, w: 15, h: 15 },
	{ spot: 'deck', x: 236, y: 38, w: 70, h: 46 },
	{ spot: 'window', x: 116, y: 8, w: 88, h: 48 },
	{ spot: 'plant', x: 6, y: 36, w: 24, h: 48 },
	{ spot: 'board', x: 62, y: 10, w: 42, h: 25 },
	{ spot: 'cork', x: 242, y: 10, w: 30, h: 28 },
	{ spot: 'laptop', x: 44, y: 44, w: 28, h: 18 },
	{ spot: 'bike', x: BIKE_XS[1] - 20, y: 100, w: 40, h: 40 },
	{ spot: 'bike', x: BIKE_XS[0] - 20, y: 100, w: 40, h: 40 },
	{ spot: 'stone', x: STONE_X - 2, y: STONE_Y - 16, w: 14, h: 18 },
];
const ARCADE = {
	spot: 'arcade' as const,
	x: 222,
	y: FRONT_Y - 40,
	w: 22,
	h: 40,
};

/** What a click at the stage's coordinates lands on, first match wins. */
export function spotAt(
	x: number,
	y: number,
	front = false,
): Hotspot | undefined {
	return [...SPOTS, ...(front ? [ARCADE] : [])].find(
		(s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h,
	)?.spot;
}
