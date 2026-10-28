import { at } from '$lib/road/along';
import { hairpinsOf } from '$lib/road/climbs';
import type { Route } from '$lib/road/route';

/**
 * The ride's one picture of the world (#4221, #4263): drawn when the world
 * closes, at the ride's best moment, with no name in it, and kept in this
 * tab's memory only. The closing card offers it beside the poster; the
 * rider chooses which to save for Strava, or both. Never uploaded, never
 * stored.
 */
let current = $state<Blob | null>(null);
let taken = $state(0);
let drawing = $state(false);
// Which ride a picture being drawn belongs to: a new ride's world lets a late one go.
let ride = 0;

export const worldPicture = {
	get current() {
		return current;
	},
	/** Pictures the rider took on this ride, so the phone remote's Photo can say it took one (#4253). */
	get taken() {
		return taken;
	},
	/** The world is drawing the picture: the closing card holds its button's place. */
	get drawing() {
		return drawing;
	},
	/** The rider took the picture: the moment they chose is the one drawn. */
	took() {
		taken++;
	},
	/** The picture `shot` will be, kept unless a new ride started meanwhile. */
	async draw(shot: Promise<Blob | null>) {
		const mine = ride;
		drawing = true;
		const picture = await shot.catch(() => null);
		if (mine !== ride) return;
		drawing = false;
		if (picture) current = picture;
	},
	/** A new ride starts without the last one's picture. */
	clear() {
		ride++;
		current = null;
		taken = 0;
		drawing = false;
	},
};

/** docs/spec/riding.md, "The ride's pictures". */
export const PICTURE = {
	/** Ridden this long first: the start arch and the count-in are not the ride. */
	settleS: 30,
	/** Strava's portrait, drawn at one pixel per pixel. */
	width: 1080,
	height: 1350,
	quality: 0.9,
	/** A summit is drawn this far below its top: you cresting it, the climb behind you. */
	belowTopM: 20,
};
/** Half the stretch a grade is read over: one sample is too noisy. */
const AROUND_M = 50;

/** A moment of the ride the picture can be drawn at: where, the light then, and your watts. */
export type PictureMoment = { m: number; p: number | null; watts: number };

/**
 * The ride's best moment, chosen when it ends from `ridden`, the moments
 * logged in order once it settled: the highest summit you crossed, else
 * the highest hairpin you rode through, else the steepest stretch. Null
 * when nothing was logged.
 */
export function bestMoment(
	route: Route,
	ridden: readonly PictureMoment[],
): PictureMoment | null {
	if (ridden.length === 0) return null;
	const lap = (m: number) =>
		route.loop ? ((m % route.length) + route.length) % route.length : m;
	/** The moment you passed metre `d` of the road, at the light and watts you rode it in. */
	const passed = (d: number): PictureMoment | null => {
		for (let k = 1; k < ridden.length; k++) {
			const a = lap(ridden[k - 1].m);
			const b = lap(ridden[k].m);
			if (a < d && d <= b) return { ...ridden[k - 1], m: d };
		}
		return null;
	};
	const highest = (ds: number[]) => {
		let best: PictureMoment | null = null;
		let top = -Infinity;
		for (const d of ds) {
			const moment = passed(d);
			if (moment && at(route, d).ele > top) {
				best = moment;
				top = at(route, d).ele;
			}
		}
		return best;
	};
	const tops = route.climbs.map((c) => c.topM - PICTURE.belowTopM);
	const summit = highest(tops.filter((d) => d > 0));
	if (summit) return summit;
	const hairpin = highest(hairpinsOf(route.road));
	if (hairpin) return hairpin;
	const grade = (m: number) =>
		at(route, lap(m) + AROUND_M).ele - at(route, lap(m) - AROUND_M).ele;
	const steepest = ridden.reduce((a, b) => (grade(b.m) > grade(a.m) ? b : a));
	return { ...steepest, m: lap(steepest.m) };
}
