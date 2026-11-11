import {
	BikeKg,
	PaceDefaultCdA,
	ParWkgA,
	ParWkgB,
	ParWkgC,
	ParWkgD,
	ReferenceRiderKg,
} from '#lib/protocol.ts';
import { gradeAt } from './at-metre';
import { createWBal } from './cpw';
import { createPace } from './pace';
import type { Road } from './road';

/**
 * The pacer on a solo route ride (#3281, docs/spec/races.md "The pacer"): a
 * par rider of the Category you pick, on the race's physics, with a W′
 * budget (#3262) so it surges on ramps and then holds par. A line of metres,
 * one per second, like your ghost's — nobody's data, and nothing reads it
 * but your own screen.
 */

/** Its W′, joules. */
export const PACER_W_PRIME = 20_000;
/** It surges to this share of par… */
export const PACER_SURGE = 1.1;
/** …on grades of this many percent or more… */
export const PACER_SURGE_GRADE = 4;
/** …while more than this share of its W′ is left. */
export const PACER_FLOOR = 0.25;
/** Within this many metres the bike computer shows the gap, and its horn sounds at hairpins. */
export const PACER_GAP_M = 50;

export const PACER_CATEGORIES = ['D', 'C', 'B', 'A'] as const;
export type PacerCategory = (typeof PACER_CATEGORIES)[number];
export const PACER_PAR: Record<PacerCategory, number> = {
	D: ParWkgD,
	C: ParWkgC,
	B: ParWkgB,
	A: ParWkgA,
};

/** The watts the pacer rides this second, its CP being `cp` and `balance` joules of W′ left. */
export function pacerWatts(cp: number, grade: number, balance: number): number {
	return grade >= PACER_SURGE_GRADE && balance > PACER_FLOOR * PACER_W_PRIME
		? cp * PACER_SURGE
		: cp;
}

/**
 * Where the pacer at `wkg` is each second, from `from` metres to the road's
 * end, setting off from a standstill as you do: its CP is `wkg` × the
 * reference rider's kg, the bike's added to its mass, shelter none.
 */
export function pacerLine(road: Road, wkg: number, from = 0): number[] {
	const cp = wkg * ReferenceRiderKg;
	const metres = [from];
	if (cp <= 0) return metres;
	const wbal = createWBal({ cp, wPrime: PACER_W_PRIME, estimate: false });
	const pace = createPace();
	while (from + pace.distance < road.length) {
		const grade = gradeAt(road, from + pace.distance);
		const watts = pacerWatts(cp, grade, wbal.balance);
		pace.step(watts, grade, ReferenceRiderKg + BikeKg, PaceDefaultCdA, 0);
		wbal.step(watts);
		metres.push(Math.min(from + pace.distance, road.length));
	}
	return metres;
}
