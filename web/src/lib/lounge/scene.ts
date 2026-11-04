/**
 * The lounge as one frame (ADR-0094), seen from above at an angle: the back
 * wall with the window, the sofa under it, the crew around one rug and
 * table, a trainer for everyone who rides. What the picture needs to know,
 * where its clickable things sit, and the order it is painted in.
 */
import type { Ctx } from '$lib/lounge/pixel';
import type { RadioPick, Weather } from '$lib/lounge/state';
import type { Sky } from '$lib/lounge/palette';
import { drawBack, drawLive, drawShade } from '$lib/lounge/draw-room';
import { drawWindow } from '$lib/lounge/draw-window';
import {
	drawFloorCrew,
	drawHearts,
	drawSofaCrew,
} from '$lib/lounge/draw-people';
import { drawCat } from '$lib/lounge/draw-cat';
import { drawDisco } from '$lib/lounge/draw-disco';
import { drawLights } from '$lib/lounge/draw-sides';
import type { Cat, Flyby, Season } from '$lib/lounge/moments';

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
	/** look.ts's HAIR_NAMES: short, long, a bun, a beanie, a mohawk, curls, a ponytail, bald. */
	hairStyle: number;
	shirt: string;
	shirtShade: string;
	/** look.ts's TOPS: a tee, a hoodie, a jersey, a sweater; and whether it is striped. */
	top: number;
	stripes: boolean;
	pants: string;
	pantsShade: string;
	shoes: string;
	/** look.ts's GLASSES: none, round, shades. */
	glasses: number;
	/** The cap's and the scarf's colours, when they wear one. */
	cap?: string;
	scarf?: string;
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
	seated: Figure[];
	floor: ({ f: Figure } & Spot)[];
	/** In the call with no spot left: counted beside the last one. */
	more: number;
}

/** A heart rising from whoever was clicked, in room pixels. */
export interface Heart {
	x: number;
	y: number;
	born: number;
}

export interface SceneInput {
	/** The whole room in scene pixels, never smaller than the stage. */
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
export function middleOf(w: number, h: number) {
	return {
		ox: Math.floor((w - SCENE_W) / 2),
		oy: Math.max(0, Math.min(48, Math.floor((h - 210) / 3))),
	};
}

/** Whether a room is tall enough for its front row: the beanbag, the plant and the arcade. */
export function hasFront(w: number, h: number): boolean {
	return h - middleOf(w, h).oy >= FRONT_Y + 14;
}

export function drawScene(g: Ctx, input: SceneInput) {
	const { ox, oy } = middleOf(input.w, input.h);
	drawBack(g, input, ox, oy);
	g.save();
	g.translate(ox, oy);
	drawWindow(g, input);
	drawLive(g, input);
	drawSofaCrew(g, input);
	// Behind everyone on the floor: its lane and spots are all further back
	// than the first row, so a rider sits in front of it, never under it.
	drawCat(g, input);
	drawFloorCrew(g, input);
	g.restore();
	drawLights(g, input);
	drawHearts(g, input);
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

export function tagsOf(crew: Crew, w: number, h: number): Tag[] {
	const { ox, oy } = middleOf(w, h);
	// Every other name on the sofa a row lower, so neighbours get twice the width.
	const tags: Tag[] = crew.seated.map((f, i) => ({
		id: f.id,
		x: ox + SEAT_XS[i],
		y: oy + 89 + (i % 2) * 7,
		head: oy + SEAT_BASE - 19,
		span: (SEAT_XS[1] - SEAT_XS[0]) * 2,
	}));
	for (const { rider, x, y } of crew.bikes)
		if (rider)
			tags.push({
				id: rider.id,
				x: ox + x,
				y: oy + y + 4,
				head: oy + y - 38,
				span: 40,
			});
	for (const { f, x, y } of crew.floor)
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
	'lamp' | 'deck' | 'window' | 'clock' | 'stove' | 'fish' | 'plant' | 'arcade';

const SPOTS: { spot: Hotspot; x: number; y: number; w: number; h: number }[] = [
	{ spot: 'clock', x: 216, y: 10, w: 22, h: 38 },
	{ spot: 'stove', x: 216, y: 48, w: 20, h: 38 },
	{ spot: 'lamp', x: 80, y: 34, w: 18, h: 28 },
	{ spot: 'fish', x: 268, y: 46, w: 15, h: 15 },
	{ spot: 'deck', x: 236, y: 38, w: 70, h: 46 },
	{ spot: 'window', x: 116, y: 8, w: 88, h: 48 },
	{ spot: 'plant', x: 6, y: 36, w: 24, h: 48 },
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
