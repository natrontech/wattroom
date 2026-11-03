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
/** The cat stays this long in one place, and takes this long to get to the next. */
export const CAT_SLOT_SEC = 150;
const CAT_WALK_SEC = 3;

export type CatPose = 'sleep' | 'sit' | 'walk';
export interface Cat {
	x: number;
	y: number;
	pose: CatPose;
	/** -1 walking left, 1 right. */
	facing: number;
}

const catSpot = (seed: number, slot: number) =>
	CAT_SPOTS[Math.floor(hash3(seed, slot, 11) * CAT_SPOTS.length)];

export function catAt(seed: number, sec: number): Cat {
	const slot = Math.floor(sec / CAT_SLOT_SEC);
	const into = sec - slot * CAT_SLOT_SEC;
	const to = catSpot(seed, slot);
	const from = catSpot(seed, slot - 1);
	if (into < CAT_WALK_SEC && from !== to) {
		const f = into / CAT_WALK_SEC;
		// A hop: up and over whatever is between the two places.
		return {
			x: from.x + (to.x - from.x) * f,
			y: from.y + (to.y - from.y) * f - Math.sin(f * Math.PI) * 14,
			pose: 'walk',
			facing: to.x < from.x ? -1 : 1,
		};
	}
	return {
		...to,
		pose: hash3(seed, slot, 12) < 0.65 ? 'sleep' : 'sit',
		facing: 1,
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
