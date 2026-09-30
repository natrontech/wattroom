/**
 * A road workout (#3026, ADR-0062): a route compiled into steady %FTP
 * blocks, one per climb or flat stretch, each pinned to the road by where it
 * ends. The engine ends a block when the rider reaches its metres (#3499);
 * the seconds here are the estimate the timeline is drawn with.
 */
import { MaxLegSeconds, PaceDefaultCdA } from '$lib/protocol';
import type { SteadyStep, Workout } from '$lib/workout/types';
import { LIMITS } from '$lib/workout/validate';
import type { Climb } from './climbs';
import { heightAt } from './at-metre';
import { steadySpeed } from './pace';
import { roadStep, type Road } from './road';

/**
 * ERG by the road (#3026's decided formula): a stretch asks for
 * 0.60 + 0.03 × its grade in % of FTP, held between 0.50 and 0.90, so a
 * climb is harder than the flat and a descent eases off without dropping out.
 */
const BASE = 0.6;
const PER_PCT = 0.03;
const FLOOR = 0.5;
const CEILING = 0.9;

export const targetFor = (gradePct: number) =>
	Math.min(CEILING, Math.max(FLOOR, BASE + PER_PCT * gradePct));

/** A stretch of the road, in metres along it: a climb, the flat between two, or the part a ride takes. */
export type Stretch = { fromM: number; toM: number };

/** The ridden stretch cut at every climb's foot and top: climbs and the flats between. */
function stretchesOf(climbs: Climb[], ridden: Stretch): Stretch[] {
	const out: Stretch[] = [];
	let at = ridden.fromM;
	for (const c of climbs) {
		const fromM = Math.max(c.startM, ridden.fromM);
		const toM = Math.min(c.topM, ridden.toM);
		if (toM <= fromM) continue;
		if (fromM > at) out.push({ fromM: at, toM: fromM });
		out.push({ fromM, toM });
		at = toM;
	}
	if (ridden.toM > at) out.push({ fromM: at, toM: ridden.toM });
	return out;
}

type Block = { toM: number; seconds: number; target: number };

/**
 * One block per stretch at its target, timed at the rider's steady speed
 * there. A block too short for the engine joins the one before it; one too
 * long for a step splits into equal parts that are not.
 */
function blocksOf(
	road: Road,
	climbs: Climb[],
	ftp: number,
	massKg: number,
	ridden: Stretch,
): Block[] {
	const out: Block[] = [];
	for (const s of stretchesOf(climbs, ridden)) {
		const length = s.toM - s.fromM;
		const grade =
			((heightAt(road, s.toM) - heightAt(road, s.fromM)) / length) * 100;
		const target = targetFor(grade);
		const speed = steadySpeed(target * ftp, grade, massKg, PaceDefaultCdA);
		const seconds = length / speed;
		const parts = Math.ceil(seconds / LIMITS.maxSeconds);
		for (let k = 1; k <= parts; k++) {
			const block = {
				toM: s.fromM + (length * k) / parts,
				seconds: Math.round(seconds / parts),
				target: Math.round(target * 100) / 100,
			};
			const last = out.at(-1);
			if (block.seconds < LIMITS.minSeconds && last) {
				last.toM = block.toM;
				last.seconds += block.seconds;
			} else out.push(block);
		}
	}
	return out;
}

/**
 * The route compiled for one rider — their FTP and their weight with the
 * bike, which is what the estimate is timed at — in legs of at most
 * MaxLegSeconds (docs/SPEC.md "Leg"): the first is the ride, later ones are
 * offered. Every block ends on the road at its `stepEndM`. Legs are named by
 * the route's generated name, never the owner's rename (#3055): a workout
 * goes out to the session, the ride list and friends' feeds. `ridden` is the
 * stretch it rides (#3105) — the whole road unless a climb or a later start
 * was picked — and every metre stays the road's own.
 */
export function compileRoad(
	route: { id: string; genName: string; road: Road; climbs: Climb[] },
	ftp: number,
	massKg: number,
	ridden: Stretch = { fromM: 0, toM: route.road.length },
): Workout[] {
	const legs: Block[][] = [[]];
	let spent = 0;
	for (const block of blocksOf(route.road, route.climbs, ftp, massKg, ridden)) {
		if (spent + block.seconds > MaxLegSeconds && legs.at(-1)!.length > 0) {
			legs.push([]);
			spent = 0;
		}
		legs.at(-1)!.push(block);
		spent += block.seconds;
	}
	let fromM = ridden.fromM;
	return legs.map((blocks, k) => {
		const steps: SteadyStep[] = blocks.map((b) => ({
			type: 'steady',
			seconds: Math.max(LIMITS.minSeconds, b.seconds),
			target: b.target,
		}));
		const toM = blocks.at(-1)!.toM;
		const leg: Workout = {
			name:
				legs.length > 1
					? `${route.genName} · leg ${k + 1} of ${legs.length}`
					: route.genName,
			road: {
				routeId: route.id,
				fromM,
				toM,
				stepEndM: blocks.map((b) => b.toM),
			},
			steps,
		};
		fromM = toM;
		return leg;
	});
}

/**
 * Any workout on a route (#3100): the road by reference, with no block pinned
 * to it. The ERG steps stay exactly as written and score as always; only where
 * the dot rides changes — solo by the rider's own watts, in a session at the
 * bunch's prescribed pace (ADR-0065). The stretch runs from `fromM` to the
 * road's end, and a road the workout already carried is replaced.
 */
export function onRoute(
	workout: Workout,
	route: { id: string; road: Road },
	fromM = 0,
): Workout {
	const toM = route.road.length;
	return {
		...workout,
		road: {
			routeId: route.id,
			fromM: Math.min(Math.max(fromM, 0), toM - roadStep(route.road)),
			toM,
		},
	};
}
