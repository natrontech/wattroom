/**
 * What happens in the lounge on its own, the same on every screen in the
 * channel: like house radio, each is a pure function of the crew and the
 * server clock, so nothing crosses the wire. The cat's naps, what flies past
 * the window, the disco ball on a drop and the time of year.
 */
import { hash3 } from '$lib/lounge/hash';

/** Where the cat may be, in the middle's coordinates: its centre and the row it rests on. */
export const CAT_SPOTS = [
	{ x: 293, y: 40 }, // on the speaker
	{ x: 110, y: 64 }, // the sofa's arm
	{ x: 34, y: 60 }, // the desk, beside the laptop
	{ x: 160, y: 106 }, // the rug, behind the table
	{ x: 22, y: 100 }, // the floor by the plant
	{ x: 298, y: 98 }, // the floor by the cabinet
] as const;
/** The cat stays this long in one place; getting to the next is the start of it. */
export const CAT_SLOT_SEC = 150;
/** The floor in front of the furniture, where the cat walks from one place to the next. */
const CAT_LANE = 94;
/** A cat's amble in stage pixels a second: across the whole room in about fourteen. */
export const CAT_PACE = 20;
/** One jump, up onto the furniture or down from it. */
const CAT_JUMP_SEC = 0.5;

export type CatPose = 'sleep' | 'sit' | 'walk' | 'leap';
export interface Cat {
	x: number;
	y: number;
	pose: CatPose;
	/** -1 walking left, 1 right. */
	facing: number;
	/** Pixels walked on this way, so its legs step with the floor and never skate. */
	stride: number;
}

type Point = { x: number; y: number };

const catSpot = (seed: number, slot: number) =>
	CAT_SPOTS[Math.floor(hash3(seed, slot, 11) * CAT_SPOTS.length)];

const onFurniture = (p: Point) => p.y < CAT_LANE - 4;

/**
 * The way between two places: down off the furniture beside it, along the
 * floor, and up beside the next. Off the furniture or onto it is a jump.
 */
function catWay(from: Point, to: Point) {
	const dir = Math.sign(to.x - from.x) || 1;
	const floor = (p: Point, side: number) =>
		onFurniture(p) ? { x: p.x + side * 8, y: CAT_LANE } : p;
	const points = [from, floor(from, dir), floor(to, -dir), to];
	return points.slice(1).map((b, i) => {
		const a = points[i];
		const leap = onFurniture(a) || onFurniture(b);
		const far = Math.hypot(b.x - a.x, b.y - a.y);
		return { a, b, leap, sec: leap ? CAT_JUMP_SEC : far / CAT_PACE, far };
	});
}

export function catAt(seed: number, sec: number): Cat {
	const slot = Math.floor(sec / CAT_SLOT_SEC);
	let into = sec - slot * CAT_SLOT_SEC;
	const to = catSpot(seed, slot);
	const from = catSpot(seed, slot - 1);
	let stride = 0;
	if (from !== to)
		for (const { a, b, leap, sec: takes, far } of catWay(from, to)) {
			if (into >= takes) {
				into -= takes;
				if (!leap) stride += far;
				continue;
			}
			const f = into / takes;
			return {
				x: a.x + (b.x - a.x) * f,
				// A jump arcs; a walk keeps to the floor.
				y: a.y + (b.y - a.y) * f - (leap ? Math.sin(f * Math.PI) * 8 : 0),
				pose: leap ? 'leap' : 'walk',
				facing: Math.sign(b.x - a.x) || Math.sign(to.x - from.x) || 1,
				stride: stride + (leap ? 0 : far * f),
			};
		}
	return {
		...to,
		pose: hash3(seed, slot, 12) < 0.65 ? 'sleep' : 'sit',
		facing: 1,
		stride: 0,
	};
}

export type FlybyKind = 'plane' | 'birds' | 'balloon' | 'peloton' | 'ufo';
export interface Flyby {
	kind: FlybyKind;
	/** 0 as it enters the window, 1 as it leaves. */
	f: number;
	/** 1 left to right, -1 the other way. */
	dir: number;
}

/** One chance of something passing the window in each slot. */
export const FLYBY_SLOT_SEC = 200;
const FLYBY_SEC: Record<FlybyKind, number> = {
	plane: 14,
	birds: 18,
	balloon: 45,
	peloton: 24,
	ufo: 9,
};

function flybyKind(r: number): FlybyKind {
	if (r < 0.04) return 'ufo';
	if (r < 0.3) return 'plane';
	if (r < 0.55) return 'birds';
	if (r < 0.75) return 'balloon';
	return 'peloton';
}

export function flybyAt(seed: number, sec: number): Flyby | undefined {
	const slot = Math.floor(sec / FLYBY_SLOT_SEC);
	if (hash3(seed, slot, 21) > 0.6) return undefined;
	const kind = flybyKind(hash3(seed, slot, 22));
	const start = slot * FLYBY_SLOT_SEC + hash3(seed, slot, 23) * 140;
	const f = (sec - start) / FLYBY_SEC[kind];
	if (f < 0 || f > 1) return undefined;
	return { kind, f, dir: hash3(seed, slot, 24) < 0.5 ? 1 : -1 };
}

/** The ball comes down for the melody of about a third of the radio's tunes. */
export function discoOn(section: string, tuneSlot: number): boolean {
	return section === 'melody' && hash3(tuneSlot, 7, 7) < 0.35;
}

/** The clock's bird calls for the first seconds of every hour. */
export function cuckooing(minutes: number, seconds: number): boolean {
	return minutes === 0 && seconds < 6;
}

export type Season = '' | 'halloween' | 'winter';

/** The week before Halloween and December up to Boxing Day dress the room. */
export function seasonOf(date: Date): Season {
	const month = date.getMonth();
	const day = date.getDate();
	if (month === 9 && day >= 25) return 'halloween';
	if (month === 11 && day <= 26) return 'winter';
	return '';
}

/** Friday from five in the evening: a pizza on the table. */
export function pizzaNight(date: Date): boolean {
	return date.getDay() === 5 && date.getHours() >= 17;
}

/** From midnight to four an owl keeps the sill. */
export function owlHours(hours: number): boolean {
	return hours < 4;
}
