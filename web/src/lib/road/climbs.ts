/**
 * A road's climbs and hairpins (#3047) — the one list the skyline, the climb
 * card, KOM arming, efforts and badges read, so no two of them can disagree
 * about where a climb is. Read off the stored road (road.ts), heights and
 * turns every ~20 m, because that is what the server holds too: its twin of
 * this rule (#3238) must find the same climbs from the same bytes.
 *
 * The rule is docs/SPEC.md's "Climbs", Garmin's: at least 500 m, at least 3 %
 * on average, and a score — length in m × average % — of at least 1,500,
 * which is 100 × the height gained. Classes by score, always in Roman
 * numerals; below the lowest a climb shows without one. The numbers are
 * protocol's, and the Go twin (server/internal/road, #3238) runs the same
 * operations in the same order on them: every step here is one of the four
 * IEEE-exact operators or a floor, so both land on the same centimetre, and
 * a climb's metres — which feed its key (#3137) — are floored centimetres
 * as #3224's keys are.
 */
import {
	ClimbClassHC,
	ClimbClassI,
	ClimbClassII,
	ClimbClassIII,
	ClimbClassIV,
	ClimbDipLossM,
	ClimbDipM,
	ClimbMinM,
	ClimbMinPct,
	ClimbMinScore,
	MaxClimbs,
} from '$lib/protocol';
import { roadStep, type Road } from './road';

export type ClimbClass = 'IV' | 'III' | 'II' | 'I' | 'HC';

export type Climb = {
	/** Metres along the road where it starts, and where it tops out: its summit. */
	startM: number;
	topM: number;
	gainM: number;
	/** Null below class IV: a climb, shown without a chip. */
	cls: ClimbClass | null;
};

/** Each class's floor: a climb is in it when its score is above this. Hardest first. */
const CLASSES: [ClimbClass, number][] = [
	['HC', ClimbClassHC],
	['I', ClimbClassI],
	['II', ClimbClassII],
	['III', ClimbClassIII],
	['IV', ClimbClassIV],
];

export const scoreOf = (gainM: number) => 100 * gainM;

export function classOf(score: number): ClimbClass | null {
	return CLASSES.find(([, floor]) => score > floor)?.[0] ?? null;
}

/** Metres floored to the centimetre: how a climb's metres enter its key (#3224). */
const cm = (m: number) => Math.floor(m * 100) / 100;

export function climbsOf(road: Road): Climb[] {
	const h = road.heights;
	const step = roadStep(road);
	const found: Climb[] = [];
	let i = 0;
	while (i < h.length - 1) {
		// Down to the foot of the next rise.
		while (i < h.length - 1 && h[i + 1] <= h[i]) i++;
		let start = i;
		let top = i;
		let j = i;
		while (++j < h.length) {
			if (h[j] > h[top]) top = j;
			else if (h[j] <= h[start]) start = top = j;
			// A dip that loses ClimbDipLossM, or is not back over the top
			// within ClimbDipM, ends the climb: a bridge over a side valley or
			// a short false flat running downhill does not.
			else if (h[top] - h[j] >= ClimbDipLossM || (j - top) * step >= ClimbDipM)
				break;
		}
		// The earliest start whose average to the top still holds the grade:
		// a long flat run-in does not dilute a steep climb out of existence.
		const holds = (s: number) =>
			h[top] - h[s] >= (ClimbMinPct / 100) * (top - s) * step;
		while (start < top && !holds(start)) start++;
		const length = (top - start) * step;
		const gainM = cm(h[top] - h[start]);
		if (length >= ClimbMinM && scoreOf(gainM) >= ClimbMinScore)
			found.push({
				startM: cm(start * step),
				topM: cm(top * step),
				gainM,
				cls: classOf(scoreOf(gainM)),
			});
		i = Math.max(top, i + 1);
	}
	return found
		.map((c, k) => ({ c, k }))
		.sort((p, q) => q.c.gainM - p.c.gainM || p.k - q.k)
		.slice(0, MaxClimbs)
		.sort((p, q) => p.k - q.k)
		.map(({ c }) => c);
}

/** A hairpin turns more than this within HAIRPIN_M (#3047). */
const HAIRPIN_RAD = 2.4;
const HAIRPIN_M = 240;
/** …and stands at least this far from the last one. */
const HAIRPIN_APART_M = 300;

/**
 * Where the road's hairpins are, in metres: each at its sharpest turn. A turn
 * sits between two samples, so it is placed half a step past the first.
 */
export function hairpinsOf(road: Road): number[] {
	const step = roadStep(road);
	const t = road.turns;
	const w = Math.max(1, Math.round(HAIRPIN_M / step));
	const out: number[] = [];
	let last = -Infinity;
	for (let i = 0; i + w <= t.length; i++) {
		let sum = 0;
		let apex = i;
		for (let k = i; k < i + w; k++) {
			sum += t[k];
			if (Math.abs(t[k]) > Math.abs(t[apex])) apex = k;
		}
		if (Math.abs((sum * Math.PI) / 180) <= HAIRPIN_RAD) continue;
		const at = (apex + 0.5) * step;
		if (at - last < HAIRPIN_APART_M) continue;
		out.push(cm(at));
		last = at;
	}
	return out;
}
