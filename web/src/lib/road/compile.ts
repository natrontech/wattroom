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

/** A stretch of the road, from a climb's foot to its top or between climbs. */
type Stretch = { fromM: number; toM: number };

/** The road cut at every climb's foot and top: climbs and the flats between. */
function stretchesOf(road: Road, climbs: Climb[]): Stretch[] {
	const out: Stretch[] = [];
	let at = 0;
	for (const c of climbs) {
		if (c.startM > at) out.push({ fromM: at, toM: c.startM });
		out.push({ fromM: c.startM, toM: c.topM });
		at = c.topM;
	}
	if (road.length > at) out.push({ fromM: at, toM: road.length });
	return out;
}

/** Height m metres along the stored road, between its samples. */
function heightAt(road: Road, m: number): number {
	const step = roadStep(road);
	const f = Math.min(Math.max(m / step, 0), road.heights.length - 1);
	const i = Math.min(Math.floor(f), road.heights.length - 2);
	return road.heights[i] + (road.heights[i + 1] - road.heights[i]) * (f - i);
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
): Block[] {
	const out: Block[] = [];
	for (const s of stretchesOf(road, climbs)) {
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
 * offered. Every block ends on the road at its `stepEndM`.
 */
export function compileRoad(
	route: { id: string; name: string; road: Road; climbs: Climb[] },
	ftp: number,
	massKg: number,
): Workout[] {
	const legs: Block[][] = [[]];
	let spent = 0;
	for (const block of blocksOf(route.road, route.climbs, ftp, massKg)) {
		if (spent + block.seconds > MaxLegSeconds && legs.at(-1)!.length > 0) {
			legs.push([]);
			spent = 0;
		}
		legs.at(-1)!.push(block);
		spent += block.seconds;
	}
	let fromM = 0;
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
					? `${route.name} · leg ${k + 1} of ${legs.length}`
					: route.name,
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
