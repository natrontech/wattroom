import { PaceDefaultCdA } from '$lib/protocol';
import { gradeAt, heightAt } from './at-metre';
import { classedOf, type Climb, type ClimbClass } from './climbs';
import { steadySpeed } from './pace';
import { roadStep, type Road } from './road';

// The issue's numbers (#3089): the card opens at the later of these two
// before a classed climb's foot, stays this far past its top, and flies the
// flamme rouge over the last kilometre.
const LEAD_M = 500;
const LEAD_S = 60;
const TAIL_M = 200;
const FLAMME_ROUGE_M = 1000;

/**
 * The climb card's numbers (#3089): the header's "CLIMB 3 of 4 · I · next
 * climb in 4.8 km" and its four fields. The card itself — where it sits,
 * how it slides in, its cues — reads these and computes none of them.
 */
export interface ClimbCard {
	cls: ClimbClass;
	n: number;
	of: number;
	/** Metres to the foot of the classed climb after this one; absent after the last. */
	nextInM?: number;
	toTopM: number;
	/** Height still to gain, net, as a climb's gain is counted (climbsOf). */
	ascentLeftM: number;
	/** The average grade between here and the top, in %. */
	avgLeftPct: number;
	/** The grade under the rider, in %. */
	grade: number;
	/** Inside the last kilometre to the top. */
	flammeRouge: boolean;
	/** Over the top, in the card's last 200 m. */
	summited: boolean;
}

/**
 * The card a rider m metres along `road` (as ridden) sees at mps metres a
 * second, or null with no classed climb near. It opens at the later of 500 m
 * or 60 s before the foot — so a slow rider is not shown a climb minutes
 * ahead — and closes 200 m past the top.
 */
export function climbCard(
	road: Road,
	climbs: Climb[],
	m: number,
	mps: number,
): ClimbCard | null {
	const classed = classedOf(climbs);
	const lead = Math.min(LEAD_M, LEAD_S * Math.max(mps, 0));
	// The latest window begun: a climb's tail gives way to the next one's lead.
	const i = classed.findLastIndex(
		(c) => c.startM - lead <= m && m < c.topM + TAIL_M,
	);
	if (i < 0) return null;
	const c = classed[i];
	const next = classed[i + 1];
	const toTopM = Math.max(c.topM - m, 0);
	const ascentLeftM = Math.max(heightAt(road, c.topM) - heightAt(road, m), 0);
	return {
		cls: c.cls,
		n: i + 1,
		of: classed.length,
		...(next ? { nextInM: next.startM - m } : {}),
		toTopM,
		ascentLeftM,
		avgLeftPct: toTopM > 0 ? (ascentLeftM / toTopM) * 100 : 0,
		grade: gradeAt(road, m),
		flammeRouge: toTopM > 0 && toTopM <= FLAMME_ROUGE_M,
		summited: m >= c.topM,
	};
}

/**
 * Seconds from m to topM holding these watts — the rider's last 30 s,
 * the card's "time to the top" — through the pace model at steady speed on
 * each stretch's own grade (Martin et al.). massKg is rider and bike. Null
 * with no power to hold.
 */
export function secondsToTop(
	road: Road,
	m: number,
	topM: number,
	watts: number,
	massKg: number,
): number | null {
	if (watts <= 0) return null;
	const step = roadStep(road);
	let seconds = 0;
	let at = Math.max(m, 0);
	// The walk counts samples rather than re-deriving one from the metre:
	// (i + 1) * step / step can round back down to i, and it stood still (#3645).
	for (let i = Math.floor(at / step) + 1; at < topM; i++) {
		const next = Math.min(topM, i * step);
		if (next <= at) continue;
		seconds +=
			(next - at) /
			steadySpeed(watts, gradeAt(road, at), massKg, PaceDefaultCdA);
		at = next;
	}
	return seconds;
}
