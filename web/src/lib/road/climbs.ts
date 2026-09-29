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
 * numerals; below the lowest a climb shows without one.
 */
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

export const MIN_CLIMB_M = 500;
export const MIN_CLIMB_PCT = 3;
export const MIN_CLIMB_SCORE = 1500;

/** Each class's floor: a climb is in it when its score is above this. Hardest first. */
const CLASSES: [ClimbClass, number][] = [
	['HC', 80_000],
	['I', 64_000],
	['II', 32_000],
	['III', 16_000],
	['IV', 8_000],
];

/**
 * A dip inside a climb that loses less than this, and is back above the top
 * it left within DIP_M, does not end the climb (#3047): a bridge over a side
 * valley, a short false flat that runs downhill.
 */
const DIP_LOSS_M = 20;
const DIP_M = 300;

/** The most climbs a road keeps: its hardest, in road order. */
export const MAX_CLIMBS = 32;

export const scoreOf = (gainM: number) => 100 * gainM;

export function classOf(score: number): ClimbClass | null {
	return CLASSES.find(([, floor]) => score > floor)?.[0] ?? null;
}

const cm = (m: number) => Math.round(m * 100) / 100;

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
			else if (h[top] - h[j] >= DIP_LOSS_M || (j - top) * step >= DIP_M) break;
		}
		// The earliest start whose average to the top still holds the grade:
		// a long flat run-in does not dilute a steep climb out of existence.
		const holds = (s: number) =>
			h[top] - h[s] >= (MIN_CLIMB_PCT / 100) * (top - s) * step;
		while (start < top && !holds(start)) start++;
		const length = (top - start) * step;
		const gain = h[top] - h[start];
		if (length >= MIN_CLIMB_M && scoreOf(gain) >= MIN_CLIMB_SCORE)
			found.push({
				startM: cm(start * step),
				topM: cm(top * step),
				gainM: cm(gain),
				cls: classOf(scoreOf(gain)),
			});
		i = Math.max(top, i + 1);
	}
	return found
		.map((c, k) => ({ c, k }))
		.sort((p, q) => q.c.gainM - p.c.gainM || p.k - q.k)
		.slice(0, MAX_CLIMBS)
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
