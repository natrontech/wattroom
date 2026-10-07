import { heightAt } from '$lib/road/at-metre';
import { climbCard, type ClimbCard } from '$lib/road/climb-card';
import { classedOf, climbsOf, type ClassedClimb } from '$lib/road/climbs';
import { turnedRound, type Road } from '$lib/road/road';
import { gradeStep, type SkylineView } from '$lib/road/skyline';

/**
 * The climb card as a surface draws it (#3645): #3089's numbers for the road
 * as this lap rides it, the climb they belong to and its profile in 100 m
 * bars. Null with no classed climb near.
 */
export interface ClimbView {
	card: ClimbCard;
	climb: ClassedClimb;
	/** The dot: metres along the road as ridden. */
	m: number;
	/** Metres to the climb's foot; 0 once on it. */
	toFootM: number;
	/** The road's height under the dot. */
	heightNow: number;
	bars: ClimbBar[];
	/** The climb's lowest and highest heights, the bars' scale. */
	lo: number;
	hi: number;
}

/** 100 m of a climb (#3645): where it ends, how high, and its grade step. */
export interface ClimbBar {
	fromM: number;
	toM: number;
	height: number;
	step: number;
}

/** The climb card's profile bars, 100 m each (#3645). */
export const BAR_M = 100;

export function climbBars(road: Road, climb: ClassedClimb): ClimbBar[] {
	const bars: ClimbBar[] = [];
	for (let from = climb.startM; from < climb.topM; from += BAR_M) {
		const to = Math.min(from + BAR_M, climb.topM);
		const height = heightAt(road, to);
		const pct = ((height - heightAt(road, from)) / (to - from)) * 100;
		bars.push({ fromM: from, toM: to, height, step: gradeStep(pct) });
	}
	return bars;
}

// A road's climbs and its turned-round copy, once per road rather than once a
// second: the road a ride rides does not change under it.
const climbsOnce = new WeakMap<Road, ReturnType<typeof climbsOf>>();
const turnedOnce = new WeakMap<Road, Road>();
function once<T>(cache: WeakMap<Road, T>, road: Road, make: () => T): T {
	let value = cache.get(road);
	if (value === undefined) cache.set(road, (value = make()));
	return value;
}

/** The climb card for a ride on a road, or null. */
export function climbView(view: SkylineView | null): ClimbView | null {
	if (!view) return null;
	const road = view.reverse
		? once(turnedOnce, view.road, () => turnedRound(view.road))
		: view.road;
	const m = view.reverse ? view.road.length - view.m : view.m;
	const climbs = once(climbsOnce, road, () => climbsOf(road));
	const card = climbCard(road, climbs, m, view.mps);
	if (!card) return null;
	const climb = classedOf(climbs)[card.n - 1];
	const bars = climbBars(road, climb);
	const heights = [heightAt(road, climb.startM), ...bars.map((b) => b.height)];
	return {
		card,
		climb,
		m,
		toFootM: Math.max(climb.startM - m, 0),
		heightNow: heightAt(road, m),
		bars,
		lo: Math.min(...heights),
		hi: Math.max(...heights),
	};
}
