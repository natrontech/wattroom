/**
 * The lounge as one frame (ADR-0094): what the picture needs to know, where
 * its clickable things sit, and the order it is painted in.
 */
import type { Ctx } from '$lib/lounge/pixel';
import type { Weather } from '$lib/lounge/state';
import type { Sky } from '$lib/lounge/palette';
import { drawRoom, drawShade, drawWalls } from '$lib/lounge/draw-room';
import { drawWindow } from '$lib/lounge/draw-window';
import { drawFloor, drawHearts, drawPeople } from '$lib/lounge/draw-people';
import { drawCat } from '$lib/lounge/draw-cat';
import { drawDisco } from '$lib/lounge/draw-disco';
import type { Cat, Flyby, Season } from '$lib/lounge/moments';
import { drawSides } from '$lib/lounge/draw-sides';

/** The room's middle, where everything you can click sits; the rest grows with the page. */
export const SCENE_W = 320;
export const SCENE_H = 180;
/** Floor in front of the middle, for the cushions, before the wall above it grows. */
const FRONT_MIN = 52;
/** Past this much wall above the middle the room grows forward instead. */
const WALL_MAX = 72;
/** The row a cushion sits on, in the middle's coordinates. */
export const FLOOR_BASE = 198;
export const CUSHION_STEP = 24;
/** The sofa's seats; anyone past them is counted on its arm. */
export const SEATS = 5;

/** Someone in the voice channel, as the scene dresses them. */
export interface Figure {
	id: string;
	name: string;
	skin: string;
	hair: string;
	shirt: string;
	speaking: boolean;
	/** Their away reason ('' for plain away), or undefined while here. */
	away?: string;
	/** A soundboard clip of theirs is playing here. */
	sounding: boolean;
	/** Heard, with no live link: drawn see-through until it redials. */
	faded: boolean;
}

export interface Rider extends Figure {
	watts: number;
	/** Where the cranks are, in radians: the component turns them at the rider's cadence. */
	crank: number;
}

/** Everyone in the call, placed (figures.ts). Floor x is in room pixels. */
export interface Crew {
	rider?: Rider;
	seated: Figure[];
	floor: { f: Figure; x: number }[];
	/** In the call with no cushion left: counted at the end of the row. */
	more: number;
}

/** A heart rising from whoever was clicked, in room pixels. */
export interface Heart {
	x: number;
	y: number;
	born: number;
}

export interface SceneInput {
	/** The whole room in scene pixels, never smaller than the middle and its front. */
	w: number;
	h: number;
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
}

/** How hard things move on this beat: a kick's fall-off, or a slow idle. */
export function pulseOf(input: SceneInput): number {
	if (input.still) return 0.8;
	if (!input.pulsing) return 0.75 + 0.1 * Math.sin(input.t);
	const f = input.beat - Math.floor(input.beat);
	return Math.exp(-f * 5);
}

/** Where the middle sits in a room of w × h: centred, with the front's floor below it. */
export function middleOf(w: number, h: number) {
	return {
		ox: Math.floor((w - SCENE_W) / 2),
		oy: Math.max(0, Math.min(WALL_MAX, h - SCENE_H - FRONT_MIN)),
	};
}

export function drawScene(g: Ctx, input: SceneInput) {
	const { ox, oy } = middleOf(input.w, input.h);
	drawWalls(g, input, oy);
	drawSides(g, input, ox, oy);
	g.save();
	g.translate(ox, oy);
	drawRoom(g, input);
	drawWindow(g, input);
	drawPeople(g, input);
	drawCat(g, input);
	g.restore();
	drawFloor(g, input, oy);
	drawHearts(g, input);
	drawShade(g, input, ox, oy);
	drawDisco(g, input, oy);
}

/** Where a name hangs under someone, and where their head is, in room pixels. */
export interface Tag {
	id: string;
	x: number;
	y: number;
	head: number;
	/** How wide their name may be. */
	span: number;
}

export function tagsOf(crew: Crew, w: number, h: number): Tag[] {
	const { ox, oy } = middleOf(w, h);
	// Every other name a row lower, so neighbours on the sofa get twice the width.
	const tags: Tag[] = crew.seated.map((f, i) => ({
		id: f.id,
		x: ox + SEAT_X0 + i * SEAT_STEP + 5,
		y: oy + 158 + (i % 2) * 9,
		head: oy + 129,
		span: SEAT_STEP * 2,
	}));
	if (crew.rider)
		tags.push({
			id: crew.rider.id,
			x: ox + 190,
			y: oy + 167,
			head: oy + 109,
			span: 48,
		});
	for (const { f, x } of crew.floor)
		tags.push({
			id: f.id,
			x,
			y: oy + FLOOR_BASE + 5,
			head: oy + FLOOR_BASE - 19,
			span: CUSHION_STEP,
		});
	return tags;
}

export type Spot = 'lamp' | 'deck' | 'window' | 'clock';

const SPOTS: { spot: Spot; x: number; y: number; w: number; h: number }[] = [
	{ spot: 'clock', x: 97, y: 24, w: 18, h: 25 },
	{ spot: 'lamp', x: 96, y: 92, w: 20, h: 28 },
	{ spot: 'deck', x: 262, y: 100, w: 50, h: 22 },
	{ spot: 'deck', x: 288, y: 132, w: 24, h: 30 },
	{ spot: 'window', x: 122, y: 22, w: 136, h: 86 },
];

/** What a click at the middle's coordinates lands on, first match wins. */
export function spotAt(x: number, y: number): Spot | undefined {
	return SPOTS.find(
		(s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h,
	)?.spot;
}

export const SEAT_X0 = 42;
export const SEAT_STEP = 18;
